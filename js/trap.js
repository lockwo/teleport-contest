// trap.js — Trap creation and trap-destination logic.
// C ref: trap.c — maketrap, hole_destination, dng_bottom, choose_trapnote.
// Stripped-down version for contest: emits the same rn2/rnd/rne PRNG call
// sequence as C during level generation so RNG parity is preserved.

import { game } from './gstate.js';
import { rn2, rnl, rn1, rnd, d } from './rng.js';
import { newsym, pline, m_at, update_topl, topl_more } from './display.js';
import { Blind, recalc_block_point } from './vision.js';
import { body_part, near_capacity, update_inventory, delobj, xname } from './invent.js';
import { observe_object } from './o_init.js';
import { find_ac } from './u_init.js';
import { exercise, acurr_eff } from './attrib.js';
import {
    HOLE, TRAPDOOR, SQKY_BOARD, is_hole, In_quest,
    RUST_TRAP, BEAR_TRAP, DART_TRAP, MAGIC_TRAP, PIT, SPIKED_PIT,
    TT_BEARTRAP, TT_PIT, A_DEX, A_STR, A_CON, A_MAX, FOOT, LEG, HEAD, SPINE, LEFT_SIDE, RIGHT_SIDE, BOTH_SIDES,
    RECURSIVETRAP, POLY_NOFLAGS, ICE,
    FORCETRAP, FORCEBUNGLE, TOOKPLUNGE, VIASITTING, FAILEDUNTRAP, HURTLING, FROMOUTSIDE,
    NOWEBMSG, TT_WEB,
    ER_NOTHING, ER_GREASED, ER_DAMAGED, ER_DESTROYED,
    MAX_ERODE, ERODE_NONE, ERODE_BURN, ERODE_RUST, ERODE_ROT, ERODE_CORRODE, ERODE_CRACK,
    EF_PAY, EF_DESTROY, EF_NONE, EF_GREASE,
    ROLLING_BOULDER_TRAP, ZAP_POS, N_DIRS, isok, DOOR, D_CLOSED, D_LOCKED,
    IS_STWALL, IS_TREE,
    is_pit, IS_POOL, IS_LAVA, TELEP_TRAP, MAGIC_PORTAL,
    IS_DOOR, MOAT, WATER, LAVAPOOL, LAVAWALL, ACCESSIBLE, D_NODOOR, D_BROKEN,
    IS_AIR, IS_ROOM, IS_WALL, SDOOR, SCORR, CORR, ROOM, DRAWBRIDGE_UP,
    Is_rogue_level, SLT_ENCUMBER, STONE, Is_botlevel, Is_stronghold, BURNING,
    STAIRS, LADDER,
    LANDMINE, FIRE_TRAP, LEVEL_TELEP, WEB, ANTI_MAGIC, VIBRATING_SQUARE,
    ARROW_TRAP, ROCKTRAP, SLP_GAS_TRAP, POLY_TRAP, In_sokoban, In_endgame,
    VAULT, IS_FURNITURE, TRAPPED_DOOR, TRAPPED_CHEST,
    POOL, MAY_DESTROY, MAY_HIT, MAY_FRACTURE, VIS_EFFECTS,
    ARM, FINGER, D_TRAPPED, D_ISOPEN, A_WIS, TIMEOUT,
} from './const.js';
import {
    objects, mksobj, weight, place_object, BOULDER, STATUE as STATUE_OTYP,
    LARGE_BOX, CHEST,
    mkcorpstat, ROCK, ARROW,
    WEAPON_CLASS, ARMOR_CLASS, SCROLL_CLASS, POTION_CLASS, SPBOOK_CLASS,
    POT_WATER,
} from './mkobj.js';
import { makemon, rndmonst_adj, monster_by_pmidx, name_to_pmidx,
         pmname_of_pmidx } from './makemon.js';
import { likes_gems_flag, M1_MINDLESS } from './monflags_data.js';
import { AD_FIRE, AD_ELEC } from './monattk_data.js';
import { MM_NOCOUNTBIRTH, MM_NOMSG, STATUE_TRAP } from './const.js';
import { In_hell as dungeon_In_hell, single_level_branch, surface, find_hell } from './dungeon.js';
import { depth } from './hacklib.js';
import { check_special_room } from './shkroom.js';

// C ref: include/onames.h — object type indices (mkobj.js OBJECT_DATA order).
const DART = 24;

// C ref: trap.c:82 `static const char tower_of_flame[] = "tower of flame";`
const TOWER_OF_FLAME = 'tower of flame';

// C ref: monst.h G_UNIQ — a species generated only once.
const G_UNIQ = 0x1000;

// C ref: onames.h PM_* — the golem forms dofiretrap()/trapeffect_fire_trap()
// name explicitly.  Resolved from the mons[] table by C's own entry name so
// the indices track monflags_data.js instead of being frozen literals.
const PM_PAPER_GOLEM = name_to_pmidx('paper golem');
const PM_STRAW_GOLEM = name_to_pmidx('straw golem');
const PM_WOOD_GOLEM = name_to_pmidx('wood golem');
const PM_LEATHER_GOLEM = name_to_pmidx('leather golem');

// C ref: hacklib.c an(str).
function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }

// ── trap query / display helpers ─────────────────────────────────────────
// C ref: trap.c t_at — is there a trap at <x,y>?
export function t_at(x, y) {
    for (const t of game.level?.traps ?? [])
        if (t.tx === x && t.ty === y) return t;
    return null;
}

// C ref: trap.h unhideable_trap(ttyp) — a trap that is visible from the moment
// it is created (maketrap() seeds ttmp->tseen with it).  Only HOLE qualifies;
// note in particular that MAGIC_PORTAL does NOT, so a freshly generated portal
// is invisible until seetrap() reveals it.
export function unhideable_trap(ttyp) { return ttyp === HOLE; }

// C ref: trap.h undestroyable_trap(ttyp) — a trap that maketrap()/
// put_lregion_here() must not overwrite or remove.
export function undestroyable_trap(ttyp) {
    return ttyp === MAGIC_PORTAL || ttyp === VIBRATING_SQUARE;
}

// ── paranoid_confirm:trap support ─────────────────────────────────────────
// C ref: trap.h:105-110 enum trap_immunities.
export const TRAP_NOT_IMMUNE = 0;
export const TRAP_CLEARLY_IMMUNE = 1;
export const TRAP_HIDDEN_IMMUNE = 2;

// C ref: drawing.c:64 defsyms[trap_to_defsym(ttyp)].explanation — the `desc`
// field of defsym.h:157-182's PCHAR/PCHAR2 entries, S_arrow_trap onward
// (rm.h:497 `trap_to_defsym(t) (S_arrow_trap + (t) - 1)`).  Complete for
// ttyp 1..TRAPNUM-1; index 0 (NO_TRAP) is unused.  Note ANTI_MAGIC is the one
// PCHAR2 entry, so its explanation is "anti-magic field", not its tile name.
// Same string trap.c:7154 trapname(ttyp, FALSE) returns.
const TRAP_EXPLANATION = [
    '',
    'arrow trap', 'dart trap', 'falling rock trap', 'squeaky board',
    'bear trap', 'land mine', 'rolling boulder trap', 'sleeping gas trap',
    'rust trap', 'fire trap', 'pit', 'spiked pit', 'hole', 'trap door',
    'teleportation trap', 'level teleporter', 'magic portal', 'web',
    'statue trap', 'magic trap', 'anti-magic field', 'polymorph trap',
    'vibrating square', 'trapped door', 'trapped chest',
];
export function trap_explanation(ttyp) { return TRAP_EXPLANATION[ttyp] ?? ''; }

// C ref: trap.c:5374-5389 into_vs_onto(traptype).
export function into_vs_onto(traptype) {
    switch (traptype) {
    case BEAR_TRAP: case PIT: case SPIKED_PIT: case HOLE:
    case TELEP_TRAP: case LEVEL_TELEP: case MAGIC_PORTAL: case WEB:
        return true;
    default:
        return false;
    }
}

// C ref: trap.c:2782-2934 immune_to_trap(mon, ttype) — would `mon` suffer any
// adverse effect from a trap of this type?  Its only caller is the
// paranoid_confirm:trap gate (hack.c:2561), always with &gy.youmonst, and it
// only distinguishes TRAP_CLEARLY_IMMUNE from everything else — so the arms
// below note where C's TRAP_HIDDEN_IMMUNE / monster branches are collapsed
// because they cannot change that answer.
//
// gy.youmonst.data is the ROLE monster (u_init.c:991 `u.umonnum = urole.mnum`),
// which is MZ_HUMAN for all 13 roles (monsters.h:3349 &c) and carries none of
// amorphous/is_whirly/unsolid/breathless/webmaker/flaming/is_floater/is_flyer/
// is_clinger.  That is what lets the BEAR_TRAP, SLP_GAS_TRAP and WEB pm tests
// collapse; a gnome or dwarf hero is STILL MZ_HUMAN here, so this must NOT be
// "corrected" to test the hero's race.
export function immune_to_trap(mon, ttype) {
    const is_you = (mon === game.u);

    switch (ttype) {
    case ARROW_TRAP:
    case DART_TRAP:
    case ROCKTRAP:
        return TRAP_NOT_IMMUNE;
    case BEAR_TRAP:
        // C: msize <= MZ_SMALL (monflag.h:178-180: MZ_SMALL 1, MZ_HUMAN 2) or
        // amorphous/whirly/unsolid -> CLEARLY_IMMUNE; a role monster is none of
        // those, so the hero always falls through to the ground-trap group.
        /* FALLTHROUGH */
    case SQKY_BOARD:
    case LANDMINE:
    case ROLLING_BOULDER_TRAP:
    case HOLE:
    case TRAPDOOR:
    case PIT:
    case SPIKED_PIT:
        // ground-based traps: evaded by levitation/flight/ceiling-clinging
        if (game.level?.flags?.sokoban_rules && (is_pit(ttype) || is_hole(ttype)))
            return TRAP_NOT_IMMUNE;
        if (In_sokoban(game.u?.uz) && ttype === ROLLING_BOULDER_TRAP)
            return TRAP_CLEARLY_IMMUNE;
        if (is_you && (game.u?.uprops?.Levitation || game.u?.uprops?.Flying))
            return TRAP_CLEARLY_IMMUNE;
        return TRAP_NOT_IMMUNE;
    case SLP_GAS_TRAP:
        // C: breathless(pm) -> CLEARLY_IMMUNE (false for a role monster), else
        // is_you && Sleep_resistance -> HIDDEN_IMMUNE, else NOT_IMMUNE.  Both
        // reachable results still make the gate ask, so an elf's intrinsic
        // sleep resistance is deliberately not consulted here.
        return TRAP_NOT_IMMUNE;
    case LEVEL_TELEP:
    case TELEP_TRAP:
        // C: In_endgame(&u.uz) || mon_has_amulet(mon) -> CLEARLY_IMMUNE.  There
        // is no mon_has_amulet() in this port and the Amulet is never carried.
        if (In_endgame(game.u?.uz)) return TRAP_CLEARLY_IMMUNE;
        return TRAP_NOT_IMMUNE;
    case POLY_TRAP:
        // C: resists_magm(mon) -> HIDDEN_IMMUNE for the hero (never CLEARLY).
        return TRAP_NOT_IMMUNE;
    case STATUE_TRAP:
        // C: only the hero is affected; a monster is CLEARLY_IMMUNE.
        return is_you ? TRAP_NOT_IMMUNE : TRAP_CLEARLY_IMMUNE;
    case WEB:
        // C: webmaker/amorphous/whirly/flaming/unsolid/gelatinous cube ->
        // CLEARLY_IMMUNE; none apply to a role monster.
        return TRAP_NOT_IMMUNE;
    case ANTI_MAGIC:
        // C hero arms: Antimagic -> NOT_IMMUNE, u.uenmax == 0 -> HIDDEN_IMMUNE,
        // otherwise NOT_IMMUNE.  None is CLEARLY_IMMUNE, so the gate always
        // asks about an anti-magic field.
        return TRAP_NOT_IMMUNE;
    case RUST_TRAP:
        // C (trap.c:2878-2892): an iron golem is always harmed; otherwise scan
        // the inventory for a rust-prone object that is WORN OR WIELDED, and
        // return CLEARLY_IMMUNE when there is none.  A quivered object and a
        // secondary weapon that isn't actually being dual-wielded are skipped,
        // because a rust trap only hits worn armor and the weapon in use — so a
        // Monk, a quarterstaff Wizard, or a Tourist whose darts are merely
        // quivered gets no prompt at all.  (PM_IRON_GOLEM needs a polymorphed
        // hero or a monster caller; neither happens here.)
        for (const obj of (game.u?.invent || game.invent || [])) {
            if (is_rustprone(obj) && (obj.owornmask || 0)) {
                if (is_you && (obj === game.uquiver
                               || (obj === game.uswapwep && !game.u?.twoweap)))
                    continue;
                return TRAP_NOT_IMMUNE;
            }
        }
        return TRAP_CLEARLY_IMMUNE;
    case MAGIC_TRAP:
        // C: for the hero, any number of bad effects.
        if (is_you) return TRAP_NOT_IMMUNE;
        /* FALLTHROUGH — for a monster a magic trap only replicates a fire trap */
    case FIRE_TRAP:
        // C: `is_you ? !Fire_resistance : !resists_fire(mon)` -> NOT_IMMUNE,
        // else a burnable-inventory scan whose only other result for the hero is
        // HIDDEN_IMMUNE.  Nothing in this port ever grants the hero
        // Fire_resistance, and neither result is CLEARLY_IMMUNE.
        return TRAP_NOT_IMMUNE;
    case MAGIC_PORTAL:
        // C: harmless, but the hero is reported non-immune so it can be asked
        // about entering.
        return is_you ? TRAP_NOT_IMMUNE : TRAP_CLEARLY_IMMUNE;
    case VIBRATING_SQUARE:
        return TRAP_CLEARLY_IMMUNE;
    default:
        // C impossible("immune_to_trap: bad ttype") then falls out.
        return TRAP_NOT_IMMUNE;
    }
}

// C ref: trap.c deltrap() — unlink and free a trap.  The lightweight port keeps
// traps in a flat array, so removal is a splice.
// GAP: C first runs clear_conjoined_pits(trap) (inert here — nothing sets
// ttmp->conjoined) and, for a pit/hole on a Sokoban level, maybe_finish_sokoban()
// — which awards the level prize and clears its sokoban_rules flag.  Sokoban
// levels DO generate now, so that second one is reachable in principle; it is
// only entered when the last pit/hole on the level is removed.
export function deltrap(trap) {
    const list = game.level?.traps;
    if (!list) return;
    const i = list.indexOf(trap);
    if (i >= 0) list.splice(i, 1);
}

// C ref: trap.c delfloortrap(ttmp) — destroy a trap that emanates from the
// floor (used by gush() to clear a trap before flooding its square).  The
// u_at() branch is unreachable from gush's only caller (it already skips the
// hero's own square), so only the monster-occupant bookkeeping applies here.
export function delfloortrap(ttmp) {
    if (!ttmp) return false;
    const removable = ttmp.ttyp === SQKY_BOARD || ttmp.ttyp === BEAR_TRAP
        || ttmp.ttyp === LANDMINE || ttmp.ttyp === FIRE_TRAP
        || is_pit(ttmp.ttyp) || is_hole(ttmp.ttyp)
        || ttmp.ttyp === TELEP_TRAP || ttmp.ttyp === LEVEL_TELEP
        || ttmp.ttyp === WEB || ttmp.ttyp === MAGIC_TRAP
        || ttmp.ttyp === ANTI_MAGIC;
    if (!removable) return false;
    const mtmp = m_at(ttmp.tx, ttmp.ty);
    if (mtmp) mtmp.mtrapped = 0;
    deltrap(ttmp);
    return true;
}

// C ref: display.c seetrap()/feeltrap() — mark a trap as seen and redraw it.
// The lightweight display layer renders the trap glyph from the trap record
// (see display.js background_glyph); here we just flip tseen + refresh.
export function seetrap(trap) {
    if (!trap) return;
    if (!trap.tseen) {
        trap.tseen = true;
        newsym(trap.tx, trap.ty);
    }
}

// C ref: dungeon.c dunlev() — level number for lev within its dungeon.
function dunlev(lev) {
    return lev?.dlevel ?? 1;
}

// C ref: dungeon.c dunlevs_in_dungeon() — lowest level number in this dungeon.
function dunlevs_in_dungeon(lev) {
    const dnum = lev?.dnum ?? 0;
    return game.dungeons?.[dnum]?.num_dunlevs ?? 1;
}

// C ref: dungeon.c — deepest level reached in this dungeon so far.
function dunlev_reached(lev) {
    const dnum = lev?.dnum ?? 0;
    return game.dungeons?.[dnum]?.dunlev_ureached ?? (lev?.dlevel ?? 1);
}

function In_hell(lev) {
    return dungeon_In_hell(lev);
}

// C ref: dungeon.c Invocation_lev(lev) — the vibrating-square level, i.e. the
// level just above Gehennom's bottom.
export function Invocation_lev(lev) {
    return In_hell(lev) && (lev?.dlevel ?? 0) === dunlevs_in_dungeon(lev) - 1;
}

// C ref: dungeon.c Can_dig_down(lev) = !svl.level.flags.hardfloor
// && !Is_botlevel(lev) && !Invocation_lev(lev).  Note the hardfloor test reads
// the CURRENT level's flags in C too (it is svl.level, not lev-relative).
export function Can_dig_down(lev) {
    return !game.level?.flags?.hardfloor && !Is_botlevel(lev) && !Invocation_lev(lev);
}

// C ref: dungeon.c Can_fall_thru(lev) = Can_dig_down(lev) || Is_stronghold(lev).
// Like Can_dig_down but also permits falling through on the stronghold level,
// whose bottom-of-dungeon status would otherwise resist both digging and falls.
export function Can_fall_thru(lev) {
    return Can_dig_down(lev) || !!Is_stronghold(lev);
}

// C ref: trap.c dng_bottom() — find "bottom" level of the dungeon, stopping
// at the quest locate level (and accounting for the unperformed invocation
// in Gehennom).
function dng_bottom(lev) {
    let bottom = dunlevs_in_dungeon(lev);

    /* when in the upper half of the quest, don't fall past the
       middle "quest locate" level if hero hasn't been there yet */
    if (In_quest(lev)) {
        const qlocate_depth = game.qlocate_level?.dlevel ?? bottom;
        if (dunlev_reached(lev) < qlocate_depth)
            bottom = qlocate_depth; /* early cut-off */
    } else if (In_hell(lev)) {
        if (!game.u?.uevent?.invoked)
            bottom -= 1;
    }
    return bottom;
}

// C ref: trap.c hole_destination() — destination dlevel for holes/trapdoors.
export function hole_destination(dst) {
    const uz = game.u?.uz;
    const bottom = dng_bottom(uz);

    dst.dnum = uz?.dnum ?? 0;
    dst.dlevel = dunlev(uz);
    while (dst.dlevel < bottom) {
        dst.dlevel++;
        if (rn2(4))
            break;
    }
}

// C ref: trap.c choose_trapnote() — pick an unused squeaky-board note.
export function choose_trapnote(ttmp) {
    const used = new Set();
    for (const trap of game.level?.traps ?? []) {
        if (trap !== ttmp && trap.ttyp === SQKY_BOARD && Number.isInteger(trap.tnote))
            used.add(trap.tnote);
    }
    const picks = [];
    for (let k = 0; k < 12; k++)
        if (!used.has(k)) picks.push(k);
    return picks.length ? picks[rn2(picks.length)] : rn2(12);
}

// C ref: trap.c trapnote() — the musical-note name of a squeaky board.  With
// noprefix false, prepend the "a"/"an" article the same way objnam.c just_an()
// does: every note name has a space at str[1], so just_an() takes its
// single-letter branch and picks "an " when the lowercased first letter is one
// of "aefhilmnosx" (e.g. "an A note", "an E flat"), else "a " ("a C note").
const TNNAMES = [
    'C note', 'D flat', 'D note', 'E flat',
    'E note', 'F note', 'F sharp', 'G note',
    'G sharp', 'A note', 'B flat', 'B note',
];
export function trapnote(trap, noprefix) {
    const tn = TNNAMES[trap.tnote];
    if (noprefix) return tn;
    const article = 'aefhilmnosx'.includes(tn[0].toLowerCase()) ? 'an ' : 'a ';
    return article + tn;
}

// C ref: trap.c maketrap() — create a trap at (x,y) of the given type.
// Contest port: keeps the lightweight trap record used by mklev/display but
// faithfully emits the PRNG calls C makes in maketrap's type switch (notably
// hole_destination's rn2(4) for holes/trapdoors).
// C ref: trap.c xdir[]/ydir[] (decl.c) — the 8 compass directions, dir 0..7.
const XDIR8 = [-1, -1, 0, 1, 1, 1, 0, -1];
const YDIR8 = [0, -1, -1, -1, 0, 1, 1, 1];

// C ref: monmove.c closed_door() — a DOOR whose doormask is closed or locked.
function closed_door(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc || loc.typ !== DOOR) return false;
    return (loc.doormask & (D_CLOSED | D_LOCKED)) !== 0;
}

// C ref: dbridge.c is_pool_or_lava() — pool or lava terrain at <x,y>.
function is_pool_or_lava(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return IS_POOL(loc.typ) || IS_LAVA(loc.typ);
}

// C ref: trap.c is_xport() — TELEP_TRAP..MAGIC_PORTAL.
function is_xport(ttyp) { return ttyp >= TELEP_TRAP && ttyp <= MAGIC_PORTAL; }

// C ref: trap.c isclearpath(cc, distance, dx, dy) — step `distance` cells in
// (dx,dy); the path is clear iff every cell is in-bounds, ZAP_POS, not a closed
// door, and free of pit/hole/xport traps.  On success cc is advanced to the far
// end.  Consumes no RNG.
function isclearpath(cc, distance, dx, dy) {
    let x = cc.x, y = cc.y;
    while (distance-- > 0) {
        x += dx; y += dy;
        if (!isok(x, y)) return false;
        const typ = game.level?.at(x, y)?.typ;
        if (typ == null || !ZAP_POS(typ) || closed_door(x, y)) return false;
        const t = t_at(x, y);
        if (t && (is_pit(t.ttyp) || is_hole(t.ttyp) || is_xport(t.ttyp)))
            return false;
    }
    cc.x = x; cc.y = y;
    return true;
}

// C ref: trap.c find_random_launch_coord(ttmp, cc) — pick a clear coord 4..8
// (2..8 for a rolling boulder trap) cells away from the trap for the launched
// object.  `Sokoban` (svl.level.flags.sokoban_rules) short-circuits to FALSE
// before any RNG: Sokoban's own rolling-boulder traps have their launch point
// fixed by the level layout, not rolled.  Otherwise the launchplace early-out
// uses gl.launchplace, which is (0,0) for a randomly generated trap (reset in
// sp_lev.c:4467); with launchplace (0,0), bcc == trap location and
// linedup(same point) is FALSE, so we always fall through to the
// rn1(5,4)/rn2(N_DIRS) search.  The while loop consumes no RNG.
function find_random_launch_coord(ttmp, cc) {
    if (game.level?.flags?.sokoban_rules) return false;
    const x = ttmp.tx, y = ttmp.ty;
    // launchplace (0,0): bcc == (x,y); linedup(x,y,x,y) returns FALSE (zero
    // displacement), so the early return is skipped.
    let mindist = 4;
    if (ttmp.ttyp === ROLLING_BOULDER_TRAP) mindist = 2;
    let distance = rn1(5, 4); /* 4..8 away — rn2(5)+4 */
    let tmp = rn2(N_DIRS);    /* randomly pick a direction to try first */
    let trycount = 0;
    let success = false;
    while (distance >= mindist) {
        const dx = XDIR8[tmp], dy = YDIR8[tmp];
        cc.x = x; cc.y = y;
        if (ttmp.ttyp === ROLLING_BOULDER_TRAP
            && is_pool_or_lava(x + distance * dx, y + distance * dy))
            success = false;
        else
            success = isclearpath(cc, distance, dx, dy);
        if (ttmp.ttyp === ROLLING_BOULDER_TRAP) {
            const bcc = { x, y };
            const success_otherway = isclearpath(bcc, distance, -dx, -dy);
            if (!success_otherway) success = false;
        }
        if (success) break;
        if (++tmp > 7) tmp = 0;
        if ((++trycount % 8) === 0) --distance;
    }
    return success;
}

// C ref: trap.c mkroll_launch(ttmp, x, y, otyp, ocount) — find a launch coord,
// drop the launched object (a BOULDER for the rolling boulder trap) there, and
// record launch / launch2 on the trap.  Returns 1.
function mkroll_launch(ttmp, x, y, otyp, ocount) {
    const cc = { x: -1, y: -1 };
    const success = find_random_launch_coord(ttmp, cc);
    if (!success) {
        cc.x = x; cc.y = y;
    } else {
        const otmp = mksobj(otyp, true, false);
        if (otmp) {
            otmp.quan = ocount;
            otmp.owt = weight(otmp);
            place_object(otmp, cc.x, cc.y);
        }
    }
    ttmp.launch = { x: cc.x, y: cc.y };
    if (ttmp.ttyp === ROLLING_BOULDER_TRAP) {
        ttmp.launch2 = { x: x - (cc.x - x), y: y - (cc.y - y) };
    } else {
        ttmp.launch_otyp = otyp;
    }
    newsym(ttmp.launch.x, ttmp.launch.y);
    return 1;
}

// C ref: trap.c mk_trap_statue(x, y) — a STATUE_TRAP holds a statue of a real
// monster, made by generating that monster, moving its inventory into the
// statue and then removing it.  RNG-wise that is: up to ten rndmonnum_adj(3,6)
// species scans (the loop rejects a co-aligned unicorn), mkcorpstat(), and a
// FULL makemon() at a random location — position search, HP, gender, starting
// inventory and all.  Leaving it unimplemented cost seed4500 the tail of its
// Dlvl 40 generation: our traptype_rnd() rolled STATUE_TRAP right alongside C
// and then simply moved on to the next trap.
function mk_trap_statue(x, y) {
    let mptr = null, trycount = 10;
    do {
        mptr = monster_by_pmidx(rndmonst_adj(3, 6)?.pmidx ?? 0);
    } while (--trycount > 0 && mptr && is_unicorn_pm(mptr)
             && Math.sign(game.u?.ualign?.type ?? 0) === Math.sign(mptr.maligntyp ?? 0));
    if (!mptr) return;
    const statue = mkcorpstat(STATUE_OTYP, null, mptr, x, y, 0 /*CORPSTAT_NONE*/);
    if (!statue) return;
    // MM_NOCOUNTBIRTH | MM_NOMSG, at a random spot (x==0,y==0).
    const mtmp = makemon(monster_by_pmidx(statue.corpsenm), 0, 0,
                         MM_NOCOUNTBIRTH | MM_NOMSG);
    if (!mtmp) return;                  /* should never happen */
    // Everything the statue's monster was carrying goes inside the statue.
    // No RNG; container contents only matter for weight and later looting.
    const inv = mtmp.minvent || [];
    while (inv.length) {
        const otmp = inv.shift();
        otmp.owornmask = 0;
        otmp.where = 'contained';
        otmp.ocontainer = statue;
        (statue.cobj || (statue.cobj = [])).push(otmp);
    }
    statue.owt = weight(statue);
    trap_mongone(mtmp);
}

// C ref: mondata.h is_unicorn(ptr) = (mlet == S_UNICORN && likes_gems(ptr)) —
// the horse half of the 'u' class is excluded by the M2_JEWELS test.
const S_UNICORN_CLS = 21;       // defsym.h MONSYM(21, 'u', UNICORN, S_UNICORN)
function is_unicorn_pm(ptr) {
    return ptr?.mcls === S_UNICORN_CLS && likes_gems_flag(ptr);
}

// C ref: mon.c mongone(mtmp) — the monster leaves without dying and without a
// corpse.  Its inventory has already been moved into the statue by the caller.
function trap_mongone(mtmp) {
    const lvl = game.level;
    if (lvl?.monsters) {
        const i = lvl.monsters.indexOf(mtmp);
        if (i >= 0) lvl.monsters.splice(i, 1);
    }
    if (mtmp.mx) newsym(mtmp.mx, mtmp.my);
}

export function maketrap(x, y, typ) {
    // C ref: trap.c:466 — the two container/door pseudo-types never become a
    // map trap.
    if (typ === TRAPPED_DOOR || typ === TRAPPED_CHEST) return null;
    // C ref: trap.c maketrap() `if ((ttmp = t_at(x, y)) != 0) { ...
    // oldplace = TRUE; }` — a square already carrying a trap gets that record
    // RE-INITIALIZED in place; it is not chained again.  Appending a second
    // record instead left t_at() answering with the FIRST (stale) type for the
    // rest of the game: on wizard1 the des-file drops a squeaky board and then
    // a sleeping gas trap on the same square, and mfndpos()/mon_mintrap() then
    // read the board — so a monster that C sends onto the gas trap (rnd(25))
    // never even gets the square as a candidate.
    const old = game.level ? t_at(x, y) : null;
    if (old && undestroyable_trap(old.ttyp)) return null;
    // C ref: trap.c:476-484 — the `else if` arm between "there was already a
    // trap here" and "make a new one": a FRESH trap is refused outright on
    // stairs/ladders, on water/lava, on furniture (unless it is a pit or hole),
    // on an air/cloud square, and a level teleporter inside a one-level branch.
    // Load-bearing for RNG, not just for the map: mktrap() draws its victim
    // rnd(4) only when a trap was actually made, so every refusal removes a
    // draw (Wiz-loca drops 3 of its 11 fixed traps onto replace_terrain'd
    // CLOUD/MOAT squares).
    if (!old && game.level) {
        const ltyp = game.level.at(x, y)?.typ;
        if (ltyp == null
            || ltyp === STAIRS || ltyp === LADDER          // CAN_OVERWRITE_TERRAIN
            || is_pool_or_lava(x, y)
            || (IS_FURNITURE(ltyp) && typ !== PIT && typ !== HOLE)
            || (ltyp === DRAWBRIDGE_UP && typ === MAGIC_PORTAL)
            || (IS_AIR(ltyp) && typ !== MAGIC_PORTAL)
            || (typ === LEVEL_TELEP && single_level_branch(game.u?.uz)))
            return null;
    }
    // C ref: maketrap() "[re-]initialize all fields except ntrap and <tx,ty>" —
    // tseen starts out as unhideable_trap(typ), i.e. TRUE only for a HOLE.
    const trap = old || { tx: x, ty: y };
    trap.ttyp = typ;
    trap.tseen = unhideable_trap(typ);
    trap.once = false;
    trap.madeby_u = 0;
    trap.launch = { x: 0, y: 0 };
    trap.dst = { dnum: -1, dlevel: -1 };
    if (!game.level) return trap;
    if (!game.level.traps) game.level.traps = [];
    // C ref: maketrap() pushes the trap onto the level list before running the
    // per-type setup (mkroll_launch reads t_at, so the trap must be present).
    if (!old) game.level.traps.push(trap);

    switch (typ) {
    case SQKY_BOARD:
        trap.tnote = choose_trapnote(trap);
        break;
    case STATUE_TRAP:
        // C ref: maketrap():508 — create a "living" statue.
        mk_trap_statue(x, y);
        break;
    case ROLLING_BOULDER_TRAP:
        // C ref: maketrap():512 — boulder will roll towards the trigger.
        mkroll_launch(trap, x, y, BOULDER, 1);
        break;
    case PIT:
    case SPIKED_PIT:
        trap.conjoined = 0;
        /* FALLTHRU */
    case HOLE:
    case TRAPDOOR: {
        if (is_hole(typ))
            hole_destination(trap.dst);
        // C ref: trap.c maketrap():529-561 — a hole/pit REWRITES the terrain it
        // is dug into.  Omitting this left makeniche's TRAPDOOR niche as SCORR
        // where C turns it into CORR, and SCORR blocks line of sight while CORR
        // does not: the wrong viz_array flips m_move's `should_see`, which picks
        // appr / gettrack and hence the rn2(4*(cnt-j)) modulus hundreds of calls
        // later (w3-elf-wiz-debug Dlvl 8, cell (4,1)).
        const lev = game.level?.at?.(x, y);
        if (lev) {
            let clear_flags = true;
            if (lev.typ === DRAWBRIDGE_UP) {
                clear_flags = false; // keep lev.drawbridgemask
            } else if (IS_ROOM(lev.typ)) {
                set_levltyp(x, y, ROOM);
            } else if (lev.typ === STONE || lev.typ === SCORR) {
                set_levltyp(x, y, CORR);
            } else if (IS_WALL(lev.typ) || lev.typ === SDOOR) {
                const lf = game.level?.flags || {};
                set_levltyp(x, y, lf.is_maze_lev ? ROOM
                                  : lf.is_cavernous_lev ? CORR : DOOR);
            }
            if (clear_flags) lev.flags = 0;
            recalc_block_point(x, y);
        }
        break;
    }
    default:
        break;
    }

    return trap;
}

// C ref: mkmaze.c set_levltyp() — refuses to overwrite STAIRS/LADDER
// (CAN_OVERWRITE_TERRAIN) and lights new lava.
function set_levltyp(x, y, newtyp) {
    const loc = game.level?.at?.(x, y);
    if (!loc) return false;
    if (loc.typ === STAIRS || loc.typ === LADDER) return false;
    loc.typ = newtyp;
    if (IS_LAVA(newtyp)) loc.lit = 1;
    return true;
}

// ── erosion / water damage ────────────────────────────────────────────────
// C ref: objclass.h material predicates.  Object material id 11 == IRON.
const MAT_IRON = 11;
function is_rustprone(obj) { return objects[obj?.otyp]?.material === MAT_IRON; }
// C ref: objclass.h erosion_matters() — only weapons and armor erode.
function erosion_matters(obj) {
    return obj?.oclass === WEAPON_CLASS || obj?.oclass === ARMOR_CLASS;
}

// C ref: apply.c splash_lit(obj) — a splash of water puts out a lit light
// source.  Correction to the old note here: C's version draws NO RNG at all
// (it is snuff_lit() plus a lantern-battery drain and a "flickers" message);
// what is unported is the SIDE EFFECT, not a roll.  Consequences of the stub:
// water_damage() on a lit candle/lamp should return ER_DAMAGED immediately
// instead of falling through to the erosion switch, and the rust trap's case-3
// sweep should snuff the hero's light source (which then changes what is lit,
// hence what is seen, on every later turn).  Needs the light-source machinery
// (snuff_lit/end_burn), which this port does not have.
function splash_lit(_obj) {
    return false;
}

// C ref: obj.h:337-344 — Is_container / Is_box / Waterproof_container.  otyps
// from mkobj.js's OBJECT_DATA order (LARGE_BOX 214 .. BAG_OF_TRICKS 220).
const LARGE_BOX_OTYP = 214, CHEST_OTYP = 215, ICE_BOX_OTYP = 216,
      OILSKIN_SACK_OTYP = 218, BAG_OF_TRICKS_OTYP = 220,
      TOWEL_OTYP = 234, CAN_OF_GREASE_OTYP = 240;
function Is_container_otyp(o) {
    return o.otyp >= LARGE_BOX_OTYP && o.otyp <= BAG_OF_TRICKS_OTYP;
}
function Waterproof_container(o) {
    return o.otyp === OILSKIN_SACK_OTYP || o.otyp === ICE_BOX_OTYP
        || o.otyp === LARGE_BOX_OTYP || o.otyp === CHEST_OTYP;
}

// C ref: trap.c water_damage_chain(obj, here) — walk a container's contents (or
// a floor pile) and water_damage() each with force=FALSE.  `here` selects the
// nexthere chain; contents use the nobj chain, which for this port is the
// container's cobj array in order.
async function water_damage_chain(list, here) {
    if (!list) return;
    const chain = Array.isArray(list) ? [...list] : [list];
    for (const o of chain) await water_damage(o, null, false);
    void here;
}

// C ref: trap.c water_damage(obj, ostr, force).  Faithful port covering the
// branches reachable from the rust trap and from dipping into a fountain/pool.
// `force` (TRUE from the rust trap and fountain dips) skips the luck-based
// ER_NOTHING saving throw.  Returns an ER_* code.
export async function water_damage(obj, ostr, force) {
    if (!obj) return ER_NOTHING;
    if (splash_lit(obj)) return ER_DAMAGED;
    // C: `if (!ostr) ostr = cxname(obj);` — callers that don't already have a
    // fixed body-slot word (rust trap) leave ostr null and rely on this default
    // (the CORPSE special case in cxname() isn't reachable via water_damage).
    if (!ostr) ostr = xname(obj);

    // C ref: trap.c water_damage() — a full can of grease and a not-yet-soaked
    // towel are handled before the greased/container/luck arms.  Neither is
    // reached by a covered session, but the ORDER is what matters: both sit
    // ahead of the luck saving throw, so a missing arm shows up as a phantom
    // rn2(20).
    if (obj.otyp === CAN_OF_GREASE_OTYP && (obj.spe | 0) > 0) return ER_NOTHING;
    if (obj.otyp === TOWEL_OTYP && (obj.spe | 0) < 7) {
        // wet_a_towel(obj, -rnd(7 - obj->spe), TRUE): a negative amt is an
        // increment by -amt (weapon.c:1043), capped at 7 by finish_towel_change.
        const amt = -rnd(7 - (obj.spe | 0));
        obj.spe = Math.min((obj.spe | 0) - amt, 7);
        return ER_NOTHING;
    }

    // Greased items: a coin-flip washes the grease off.  (rn2(2) must fire.)
    if (obj.greased) {
        if (!rn2(2)) {
            obj.greased = 0;
        }
        return ER_GREASED;
    }

    // C ref: trap.c water_damage() container arms, both ahead of the luck
    // throw.  A waterproof container (oilskin sack / ice box / large box /
    // chest) shrugs the water off with NO roll at all unless it is cursed, in
    // which case `obj->cursed && !rn2(3)` decides whether the contents get wet.
    // Missing both arms, a chest on a square flooded by fountain.c gush() fell
    // through to `(Luck + 5) > rn2(20)` and drew a phantom rn2(20) (seed4500
    // step 1329).
    if (Is_container_otyp(obj)
        && (!Waterproof_container(obj) || (obj.cursed && !rn2(3)))) {
        await water_damage_chain(obj.cobj, false);
        return ER_DAMAGED;   /* contents were damaged */
    }
    if (Waterproof_container(obj)) return ER_DAMAGED;

    // Luck-based protection (skipped when force is TRUE, as the rust trap does).
    if (!force) {
        const luck = game.u?.uluck || 0;
        if ((luck + 5) > rn2(20)) return ER_NOTHING;
    }

    switch (obj.oclass) {
    case SCROLL_CLASS:
        // C blanks the scroll (SCR_BLANK_PAPER already returns 0/ER_NOTHING);
        // the reached rust/dip sessions don't carry blank scrolls, so damage.
        return ER_DAMAGED;
    case SPBOOK_CLASS:
        return ER_DAMAGED;
    case POTION_CLASS:
        // C ref: potion of acid is destroyed; a diluted potion becomes water;
        // any non-water potion dilutes one step (ER_DAMAGED); an undiluted
        // potion of (holy/plain) water is unaffected (ER_NOTHING).  None of
        // these branches consume RNG.
        if (obj.odiluted) {
            obj.otyp = POT_WATER;
            obj.dknown = 0;
            obj.blessed = false;
            obj.cursed = false;
            obj.odiluted = 0;
            return ER_DAMAGED;
        } else if (obj.otyp !== POT_WATER) {
            obj.odiluted = (obj.odiluted || 0) + 1;
            return ER_DAMAGED;
        }
        return ER_NOTHING; // undiluted water: no effect
    default:
        return await erode_obj(obj, ostr, ERODE_RUST, EF_NONE);
    }
}

// ── erode_obj (general) ───────────────────────────────────────────────────
// C ref: objclass.h material predicates for the other 4 erosion types (IRON's
// is_rustprone is already defined above).  Scoped to worn armor: destroy_arm()
// (the only caller) never passes anything else, so the WAN_FIRE/candle carve-
// outs in C's is_flammable (armor is never one of those otypes) are omitted.
const MAT_LIQUID = 1, MAT_WOOD = 8, MAT_DRAGON_HIDE = 10, MAT_COPPER = 13,
    MAT_PLASTIC = 18, MAT_GLASS = 19;
function is_flammable(obj) {
    const mat = objects[obj?.otyp]?.material;
    return (mat <= MAT_WOOD && mat !== MAT_LIQUID) || mat === MAT_PLASTIC;
}
function is_rottable(obj) {
    const mat = objects[obj?.otyp]?.material;
    return (mat <= MAT_WOOD && mat !== MAT_LIQUID) || mat === MAT_DRAGON_HIDE;
}
function is_corrodeable(obj) {
    const mat = objects[obj?.otyp]?.material;
    return mat === MAT_COPPER || mat === MAT_IRON;
}
function is_crackable(obj) {
    return objects[obj?.otyp]?.material === MAT_GLASS && obj?.oclass === ARMOR_CLASS;
}

// C ref: do_wear.c obj_erode_type() — which erosion type (if any) applies to
// a piece of gear, by material.  Order matters: flammable is checked first.
export function obj_erode_type(obj) {
    if (is_flammable(obj)) return ERODE_BURN;
    if (is_rustprone(obj)) return ERODE_RUST;
    if (is_crackable(obj)) return ERODE_CRACK;
    if (is_rottable(obj)) return ERODE_ROT;
    if (is_corrodeable(obj)) return ERODE_CORRODE;
    return ERODE_NONE;
}

// C ref: zap.c inventory_resistance_check(dmgtyp) — chance a carried
// protective item (e.g. a fire-resistant cloak) shields another item.  Not
// modeled: no covered hero carries such gear, so this always takes C's own
// "prob == 0" fast path and (like C) consumes no RNG.
function inventory_resistance_check(_dmgtyp) { return false; }

// C ref: mkobj.c costly_alteration(obj, alter_type) — shop billing for a
// damaged item.  A no-op for anything not flagged unpaid (no RNG either way);
// shop billing itself isn't modeled.
function costly_alteration(_obj, _alter_type) {}

// C ref: objnam.c vtense(subj, verb) — 3rd-person-singular conjugation of
// `verb`, unless `subj` is a plural-shaped noun ("gloves", "boots", ending in
// 's' but not "us"/"ss").  Scoped to the plain armor-name strings erode_obj
// passes here (no "a "/"an " article, no "of"-clause subjects).
function vtense_sing(verb) {
    const last = verb[verb.length - 1]?.toLowerCase();
    const prev = verb.length >= 2 ? verb[verb.length - 2].toLowerCase() : '';
    if (verb.toLowerCase() === 'are') return 'is';
    if (verb.toLowerCase() === 'have') return verb.slice(0, -2) + 's';
    if (last === 'z' || last === 'x' || last === 's'
        || (verb.length >= 2 && last === 'h' && (prev === 'c' || prev === 's'))
        || (verb.length === 2 && last === 'o'))
        return verb + 'es';
    if (last === 'y' && !'aeiou'.includes(prev))
        return verb.slice(0, -1) + 'ies';
    return verb + 's';
}
function vtense(subj, verb) {
    if (subj && !/^(a |an )/i.test(subj)) {
        const last = subj[subj.length - 1]?.toLowerCase();
        const prev = subj.length >= 2 ? subj[subj.length - 2].toLowerCase() : '';
        if (last === 's' && subj.length > 1 && prev !== 'u' && prev !== 's')
            return verb; // plural-shaped noun ("gloves", "boots"): unchanged
    }
    return vtense_sing(verb);
}

// Unwear a destroyed armor piece: clear whichever hero armor slot references
// it and its owornmask.  C's remove_worn_item()/Cloak_off()/&c also recompute
// AC and drop any granted intrinsic; not modeled (erosion reaching an already
// fully-eroded piece isn't exercised by the covered starts).
function unwear_armor(otmp) {
    for (const slot of ['uarm', 'uarmc', 'uarmh', 'uarms', 'uarmg', 'uarmf', 'uarmu'])
        if (game[slot] === otmp) game[slot] = null;
    otmp.owornmask = 0;
}

const ERODE_ACTION = ['smoulder', 'rust', 'rot', 'corrode', 'crack'];

// C ref: trap.c:360 grease_protect(otmp, ostr, victim) — a greased item shrugs
// the erosion off; the grease itself wears away on !rn2(2).  Only the hero-
// carried case is reachable here (erode_obj's only greased caller is the hero's
// own gear), so the vismon/Yobjnam2 monster wording is left out.
export async function grease_protect(otmp, ostr, victim) {
    const txt = 'protected by the layer of grease!';
    if (ostr && victim === game.u)
        await update_topl(`Your ${ostr} ${vtense(ostr, 'are')} ${txt}`);
    if (!rn2(2)) {
        otmp.greased = 0;
        await update_topl('The grease dissolves.');
        update_inventory();
        return true;
    }
    return false;
}

// C ref: trap.c erode_obj(otmp, ostr, type, ef_flags).  Correction to the old
// note here: destroy_arm() is NOT the only call site — water_damage()'s default
// arm routes every non-scroll/book/potion hero item through this too.  What is
// genuinely omitted is (a) the monster-carried / floor-object (vismon/visobj)
// message variants, which no call site can reach, and (b) two ef_flags no
// caller passes: EF_GREASE (which would divert to grease_protect()'s rn2(2)
// grease-burn-off — a REAL draw if a caller ever passes it) and EF_VERBOSE
// (the "not affected by oxidation" lines).
export async function erode_obj(otmp, ostr, type, ef_flags) {
    if (!otmp) return ER_NOTHING;

    let vulnerable;
    // C ref: trap.c:182 `check_grease = (ef_flags & EF_GREASE)`, cleared again
    // by the ERODE_BURN and ERODE_ROT arms (fire and decay ignore grease).
    let check_grease = (ef_flags & EF_GREASE) !== 0;
    switch (type) {
    case ERODE_BURN:
        if (inventory_resistance_check('FIRE')) return ER_NOTHING;
        vulnerable = is_flammable(otmp);
        check_grease = false;
        break;
    case ERODE_RUST:
        vulnerable = is_rustprone(otmp);
        break;
    case ERODE_ROT:
        vulnerable = is_rottable(otmp);
        check_grease = false;
        break;
    case ERODE_CORRODE:
        if (inventory_resistance_check('ACID')) return ER_NOTHING;
        vulnerable = is_corrodeable(otmp);
        break;
    case ERODE_CRACK:
        vulnerable = is_crackable(otmp);
        break;
    default:
        return ER_NOTHING;
    }
    const is_primary = type !== ERODE_ROT && type !== ERODE_CORRODE;
    const erosion = is_primary ? (otmp.oeroded || 0) : (otmp.oeroded2 || 0);

    // C ref: trap.c:246 — grease is checked FIRST, ahead of erosion_matters().
    if (check_grease && otmp.greased) {
        await grease_protect(otmp, ostr, game.u);
        return ER_GREASED;
    } else if (!erosion_matters(otmp)) {
        return ER_NOTHING;
    } else if (!vulnerable || (otmp.oerodeproof && otmp.rknown)) {
        return ER_NOTHING;
    } else if (otmp.oerodeproof || (otmp.blessed && !rnl(4))) {
        // C: blessed objects get a luck-modulated saving roll (rnl(4)); it
        // must fire here (when reached) to stay in sync with C.
        if (otmp.oerodeproof) {
            otmp.rknown = true;
            update_inventory();
        }
        return ER_NOTHING;
    } else if (erosion < MAX_ERODE) {
        const adverb = (erosion + 1 === MAX_ERODE) ? ' completely' : erosion ? ' further' : '';
        await update_topl(`Your ${ostr} ${vtense(ostr, ERODE_ACTION[type])}${adverb}!`);
        if (ef_flags & EF_PAY) costly_alteration(otmp, type);
        if (is_primary) otmp.oeroded = erosion + 1; else otmp.oeroded2 = erosion + 1;
        update_inventory();
        // C ref: allmain.c moveloop_core() — find_ac() runs once per player
        // input, not from erode_obj itself (see read.js destroy_arm()), so an
        // eroded piece's AC penalty shows up starting with the NEXT screen;
        // callers that don't already have their own find_ac() call (like
        // destroy_arm's) are responsible for adding one after this returns.
        return ER_DAMAGED;
    } else if (ef_flags & EF_DESTROY) {
        otmp.in_use = 1;
        const actbuf = (type === ERODE_CRACK) ? 'shatters' : `${vtense(ostr, ERODE_ACTION[type])} away`;
        await update_topl(`Your ${ostr} ${actbuf}!`);
        if (ef_flags & EF_PAY) costly_alteration(otmp, type);
        if (otmp.owornmask) unwear_armor(otmp);
        delobj(otmp);
        return ER_DESTROYED;
    }
    return ER_NOTHING;
}

// ── dotrap / trap effect dispatch ─────────────────────────────────────────
// C ref: hack.c nomul(0) — interrupt any multi-turn action.
function trap_nomul() {
    game.multi = 0;
    if (game.context) {
        game.context.travel = game.context.travel1 = game.context.mv = 0;
    }
}

// C ref: trap.c trapeffect_rust_trap(&youmonst, trap, trflags) — the hero
// variant.  Rolls rn2(5) to pick which body location the gush of water hits,
// then water_damage()s the relevant gear.  case 3 (the "default") splashes the
// hero generally and rusts cloak/suit/shirt.
async function trapeffect_rust_trap(trap, _trflags) {
    const u = game.u;
    seetrap(trap);

    switch (rn2(5)) {
    case 0:
        pline('A gush of water hits you on the head!');
        await water_damage(game.uarmh, 'helm', true);
        break;
    case 1:
        pline('A gush of water hits your left arm!');
        if (await water_damage(game.uarms, 'shield', true) !== ER_NOTHING) break;
        if (u?.twoweap || (game.uwep && false /* bimanual unmodeled */))
            await water_damage(u?.twoweap ? game.uswapwep : game.uwep, null, true);
        await water_damage(game.uarmg, 'gloves', true);
        break;
    case 2:
        pline('A gush of water hits your right arm!');
        await water_damage(game.uwep, null, true);
        await water_damage(game.uarmg, 'gloves', true);
        break;
    default:
        pline('A gush of water hits you!');
        // splash any lit light sources (excludes wielded weapons; none of the
        // owned sessions carry a lit source so this consumes no PRNG)
        for (const otmp of (u?.invent || game.invent || [])) {
            if (otmp.lamplit && otmp !== game.uwep
                && (otmp !== game.uswapwep || !u?.twoweap))
                splash_lit(otmp);
        }
        if (game.uarmc)
            await water_damage(game.uarmc, 'cloak', true);
        else if (game.uarm)
            await water_damage(game.uarm, 'suit', true);
        else if (game.uarmu)
            await water_damage(game.uarmu, 'shirt', true);
        break;
    }
    // C ref: allmain.c moveloop_core() — find_ac() runs once per player input
    // (see read.js destroy_arm()'s matching comment), so a rusted/corroded
    // piece's AC penalty shows up starting with the NEXT screen, not eagerly
    // from inside water_damage/erode_obj.
    find_ac();
}

// C ref: hack.c losehp(n, knam, k_format) — for a non-polymorphed hero this
// subtracts the damage from u.uhp.  No RNG.
// GAP: C's `if (u.uhp < 1) { You("die..."); done(DIED); }` is replaced by a
// clamp to 0, so a trap that would kill the hero leaves them walking around at
// 0 HP instead of ending the game.  Also unported: maybe_wail() when the blow
// drops the hero below a tenth of uhpmax (message only, no RNG).
function losehp(n) {
    const u = game.u;
    if (!u) return;
    u.uhp -= n;
    if (u.uhp > u.uhpmax) u.uhpmax = u.uhp;
    else game.botl = true;
    if (u.uhp < 1) u.uhp = 0;
}

// C ref: hacklib.c exclam(force) — "!" for damage > 5, "." otherwise.
function exclam(force) { return force > 5 ? '!' : '.'; }

// C ref: objnam.c an() — indefinite article prefix for a plain noun.
function an_str(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }

// C ref: hacklib.c upstart() — capitalize the first letter of a string.
function upstart_trap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// C ref: mthrowu.c thitu(tlev, dam, objp, name) — resolve a trap missile (here
// a dart fired by a dart trap) landing on the hero.  For the named-missile
// path (name != NULL, e.g. "little dart") the message uses an(name) and there
// is no obj-specific naming.  Rolls dieroll = rnd(20); a hit needs
// u.uac + tlev > dieroll.  On a hit: "You are hit by a little dart!", then
// losehp(dam) [no RNG] + exercise(A_STR, FALSE) [rn2(2)].  Returns 1 on hit.
async function thitu_named(tlev, dam, name) {
    const { update_topl } = await import('./display.js');
    const u = game.u;
    const uac = u?.uac ?? 10;
    const dieroll = rnd(20);                     // mthrowu.c:106
    const onm = an_str(name);
    if (uac + tlev <= dieroll) {
        // Miss feedback (verbose).  C: pline("%s %s you.", upstart(onmbuf),
        // vtense(onmbuf, "miss")) where onmbuf = an(name) -> "a little dart"
        // -> "A little dart misses you." (not "The little dart ...").
        if (uac + tlev <= dieroll - 2)
            await update_topl(`${upstart_trap(onm)} ${vtense(onm, 'miss')} you.`);
        else
            await update_topl(`You are almost hit by ${onm}.`);
        return 0;
    }
    // Hit: You("are hit by %s%s", onm, exclam(dam)).
    await update_topl(`You are hit by ${onm}${exclam(dam)}`);
    losehp(dam);                                 // no RNG
    exercise(0 /*A_STR*/, false);                // rn2(2)
    return 1;
}

// C ref: trap.c t_missile(otyp, trap) — mksobj(otyp, TRUE, FALSE) for the trap
// missile; quan forced to 1, opoisoned cleared, position set to the trap.
export function t_missile(otyp, trap) {
    const otmp = mksobj(otyp, true, false);
    otmp.quan = 1;
    otmp.owt = weight(otmp);
    otmp.opoisoned = 0;
    otmp.ox = trap.tx; otmp.oy = trap.ty;
    return otmp;
}

// C ref: trap.c trapeffect_arrow_trap(&gy.youmonst, trap, trflags) — the hero
// steps onto an arrow trap.  Same shape as the dart trap minus the poison
// roll: t_missile's mksobj, dmgval's rnd(oc_wsdam), then thitu(8, ...)'s
// rnd(20) (+ exercise's rn2(2) on a hit).  A previously-triggered, seen trap
// misfires on !rn2(15) ("You hear a loud click!") and is removed.
async function trapeffect_arrow_trap(trap, _trflags) {
    const u = game.u;
    const { dmgval } = await import('./uhitm.js');
    if (trap.once && trap.tseen && !rn2(15)) {
        await pline('You hear a loud click!');
        deltrap(trap);
        newsym(u.ux, u.uy);
        return;
    }
    trap.once = 1;
    seetrap(trap);
    // update_topl(), not pline(): C's pline() APPENDS to a topline that is
    // still TOPLINE_NEED_MORE, and try_disarm()'s "Whoops..." leaves one
    // pending when move_into_trap() springs this trap.  With nothing pending
    // the two are equivalent (both leave the line NEED_MORE for thitu's hit
    // line to append to, the C topl.c CO-8 rule the dart trap relies on).
    await update_topl('An arrow shoots out at you!');
    const otmp = t_missile(ARROW, trap);
    // dmgval(otmp, &gy.youmonst): a role monster is not large -> rnd(oc_wsdam).
    const dam = dmgval(otmp, { data: { msize: 0 } });
    // u.usteed is null for the contest hero -> the rn2(2)/steedintrap arm is
    // short-circuited before its roll.
    if (await thitu_named(8, dam, 'arrow')) {
        // Hit: the arrow is consumed (obfree).  No floor object.
    } else {
        const { stackobj } = await import('./invent.js');
        place_object(otmp, u.ux, u.uy);
        otmp.where = 'floor'; otmp.ox = u.ux; otmp.oy = u.uy;
        if (!Blind()) observe_object(otmp);
        stackobj(otmp);
        newsym(u.ux, u.uy);
    }
}

// C ref: trap.c trapeffect_sqky_board(&gy.youmonst, trap, trflags) — the hero
// steps on a squeaky board.  Consumes no RNG itself, but wake_nearby(FALSE)
// clears msleeping/STRAT_WAITMASK on every monster within ulevel*20, which
// changes who acts on the following turns (and therefore the RNG stream).
async function trapeffect_sqky_board(trap, trflags) {
    const u = game.u;
    const forcetrap = (trflags & FORCETRAP) !== 0 || (trflags & FAILEDUNTRAP) !== 0
        || (!!u?.uprops?.Flying && (trflags & VIASITTING) !== 0);
    if ((u?.uprops?.Levitation || u?.uprops?.Flying) && !forcetrap) {
        if (!Blind()) {
            seetrap(trap);
            await pline('You notice a loose board below you.');
        }
        return;
    }
    seetrap(trap);
    // Deaf is never set for the contest hero, so C's "vibrates" arm is dead.
    await pline(`A board beneath you squeaks ${trapnote(trap, false)} loudly.`);
    // cmd.js's copy, not monmove.js's: only that one carries C's wake_msg()
    // ("<Monster> wakes up.") which lands on the topline after the squeak.
    const { wake_nearby } = await import('./cmd.js');
    await wake_nearby(false);
}

// C ref: trap.c trapeffect_dart_trap(&youmonst, trap, trflags) — the hero
// steps onto a dart trap.  For a freshly-triggered (trap->once == 0) trap the
// soft-click escape (rn2(15)) is skipped; the dart is created (mksobj order),
// a 1-in-6 poison check fires, dmgval(dart, &youmonst) rolls damage, and
// thitu(7, dam, ..., "little dart") resolves the hit (the recorded hero is on
// foot so the usteed branch is skipped).  On a hit the dart is freed; on a
// miss it settles on the floor (place_object + stackobj).  RNG order matches C
// exactly: next_ident + mksobj_init + mkobj_erosions (inside t_missile), then
// rn2(6) poison, rnd(oc_wsdam) dmgval, rnd(20) thitu, rn2(2) exercise.
async function trapeffect_dart_trap(trap, _trflags) {
    const u = game.u;
    const { dmgval } = await import('./uhitm.js');
    // C: on a RE-trigger (trap->once already set) of a seen trap the dart
    // misfires on !rn2(15).  trap->once is 0 the first time, so C's && stops
    // before the roll — but the roll is real on every later trigger.
    if (trap.once && trap.tseen && !rn2(15)) {
        await pline('You hear a soft click.');
        deltrap(trap);
        newsym(u.ux, u.uy);
        return;
    }
    trap.once = 1;
    seetrap(trap);
    // C: pline("A little dart shoots out at you!").  Mark the topline NEED_MORE
    // so thitu's update_topl("You are hit by a little dart!") appends to the
    // same line (C topl.c update_topl CO-8 rule) rather than replacing it.
    await update_topl('A little dart shoots out at you!');
    const otmp = t_missile(DART, trap);
    if (!rn2(6)) otmp.opoisoned = 1;             // trap.c:1273
    // dmgval(otmp, &youmonst): the human hero is not a large monster, so this
    // is rnd(oc_wsdam) (+spe).  A youmonst stand-in with a small msize selects
    // the small-monster die in uhitm.dmgval.
    const dam = dmgval(otmp, { data: { msize: 0 } });
    // u.usteed is null for the recorded (on-foot) hero -> skip the steed branch.
    const oldumort = u?.umortality | 0;
    if (await thitu_named(7, dam, 'little dart')) {
        // C ref: trap.c:1281 — a poisoned dart that HITS runs poisoned() before
        // obfree().  `fatal` is 0 when the damage already triggered life-saving
        // (u.umortality rose), else 10.
        if (otmp.opoisoned) {
            const { poisoned } = await import('./attrib.js');
            await poisoned('dart', A_CON, 'little dart',
                           ((u?.umortality | 0) > oldumort) ? 0 : 10, true);
        }
    } else {
        // Miss: the dart settles on the hero's square.
        const { stackobj } = await import('./invent.js');
        place_object(otmp, u.ux, u.uy);
        otmp.where = 'floor'; otmp.ox = u.ux; otmp.oy = u.uy;
        if (!Blind()) observe_object(otmp);   // trap.c:1290, as in rocktrap
        stackobj(otmp);
        newsym(u.ux, u.uy);
    }
}

// C ref: trap.c trapeffect_web(&gy.youmonst, trap, trflags) — the hero walks
// into a spider web.  mu_maybe_destroy_web() is FALSE for a role monster (none
// is amorphous/whirly/flaming/unsolid/a gelatinous cube) and webmaker() is
// FALSE too, so the hero always gets stuck.  Exactly ONE roll fires, selected
// by ACURR(A_STR) — and a hero with exceptional (18/xx, encoded >= 19) or
// merely 18 strength takes the `tim = 1` arm, which draws NOTHING.
// hack.c trapmove()'s TT_WEB arm (cmd.js) already runs the struggle-out.
async function trapeffect_web(trap, trflags) {
    const u = game.u;
    const webmsgok = (trflags & NOWEBMSG) === 0;
    const forcetrap = (trflags & FORCETRAP) !== 0 || (trflags & FAILEDUNTRAP) !== 0;
    const viasitting = (trflags & VIASITTING) !== 0;

    seetrap(trap); // feeltrap()
    if (webmsgok) {
        const verbbuf = (forcetrap || viasitting)
            ? 'are caught by' : `${u_locomotion('stumble')} into`;
        await pline(`You ${verbbuf} ${a_your(trap.madeby_u)} spider web!`);
    }
    set_utrap(1, TT_WEB); /* time is adjusted below */
    // ACURR(A_STR): acurr_eff returns the C-encoded strength (3..18, then
    // 19..118 for 18/01..18/**), which is what C's str brackets compare.
    const str = acurr_eff(A_STR);
    let tim;
    if (str <= 3) tim = rn1(6, 6);
    else if (str < 6) tim = rn1(6, 4);
    else if (str < 9) tim = rn1(4, 4);
    else if (str < 12) tim = rn1(4, 2);
    else if (str < 15) tim = rn1(2, 2);
    else if (str < 18) tim = rnd(2);
    else if (str < 69) tim = 1;
    else {
        tim = 0;
        if (webmsgok)
            await pline(`You tear through ${a_your(trap.madeby_u)} web!`);
        deltrap(trap);
        newsym(u.ux, u.uy);
    }
    set_utrap(tim, TT_WEB);
}

// C ref: trap.c trapeffect_slp_gas_trap(&gy.youmonst, trap, trflags).
// breathless(gy.youmonst.data) is FALSE for every role monster, so the branch
// turns purely on Sleep_resistance.  NOTE: nothing in this port grants the
// hero SleepResistance yet (u_init.c's racial/role intrinsics are unported),
// so an elf or a Monk takes the wrong arm here and draws an rnd(25) C skips —
// that is a u_init gap, not a trap.c one.
async function trapeffect_slp_gas_trap(trap, _trflags) {
    seetrap(trap);
    const { Sleep_resistance, fall_asleep } = await import('./zap.js');
    if (Sleep_resistance()) {
        await pline('You are enveloped in a cloud of gas!');
    } else {
        await pline('A cloud of gas puts you to sleep!');
        fall_asleep(-rnd(25), true);
    }
    // steedintrap(trap, NULL): no steed -> returns before any RNG.
}

// C ref: trap.c set_utrap(tim, typ) — mark the hero trapped for `tim` turns.
function set_utrap(tim, typ) {
    const u = game.u;
    if (!u) return;
    u.utrap = tim;
    u.utraptype = typ;
}

// C ref: do.c set_wounded_legs(side, timex).  When the hero first gains wounded
// legs, ATEMP(A_DEX)-- (the displayed Dx drops by 1); the timeout is (re)set to
// at least `timex`.  Consumes no RNG.  Riding moves the wound to the steed but
// the contest hero is dismounted when the bear trap fires.  C ends with
// encumber_msg() (do.c:2445): a wounded leg lowers weight_cap, so a hero who
// was near capacity becomes Burdened and gets the "slowed slightly" message
// immediately — this fires BEFORE the bear trap's losehp(), which is why the
// trap's --More-- frame still shows the pre-damage HP (seed0004 step 27).
export async function set_wounded_legs(side, timex) {
    const u = game.u;
    if (!u) return;
    game.botl = true; // C ref: do.c:2433 — disp.botl = TRUE; before encumber_msg()
    u.atemp = u.atemp || { a: Array(A_MAX).fill(0) };
    u.eprops = u.eprops || {};
    const already = (u.HWounded_legs || 0) || (u.EWounded_legs || 0);
    if (!already) u.atemp.a[A_DEX] = (u.atemp.a[A_DEX] || 0) - 1;
    if (!already || (u.HWounded_legs || 0) < timex) u.HWounded_legs = timex;
    u.EWounded_legs = (u.EWounded_legs || 0) | side;
    const { encumber_msg } = await import('./invent.js');
    await encumber_msg();
}

// C ref: do.c heal_legs(how) — cure wounded legs (called from nh_timeout when the
// WOUNDED_LEGS timer expires, how==0).  Restores the -1 Dx (ATEMP(A_DEX)++),
// announces "Your leg(s) feel(s) better." (skipped while mounted or petrifying),
// clears the wound, and (how==0) re-checks encumbrance — a healed leg raises
// weight_cap, so a Burdened hero is announced "now unencumbered".  No RNG.
export async function heal_legs(how) {
    const u = game.u;
    if (!u) return;
    if (!((u.HWounded_legs || 0) || (u.EWounded_legs || 0))) return; // !Wounded_legs
    game.botl = true;
    u.atemp = u.atemp || { a: Array(A_MAX).fill(0) };
    if ((u.atemp.a[A_DEX] || 0) < 0) u.atemp.a[A_DEX]++;
    if (!u.usteed && how !== 2) {
        // body_part(LEG) == "leg"; both sides wounded -> makeplural -> "legs".
        const both = ((u.EWounded_legs || 0) & BOTH_SIDES) === BOTH_SIDES;
        const legs = both ? 'legs' : body_part(LEG);
        // vtense((char*)0? no — vtense(legs,"feel")): plural subj -> "feel",
        // singular -> "feels".
        const feel = both ? 'feel' : 'feels';
        const { update_topl } = await import('./display.js');
        await update_topl(`Your ${legs} ${feel} better.`);
    }
    u.HWounded_legs = 0;
    u.EWounded_legs = 0;
    if (how === 0) {
        const { encumber_msg } = await import('./invent.js');
        await encumber_msg();
    }
}

// C ref: trap.c trapeffect_bear_trap(&youmonst, trap, trflags) — the hero
// variant for a level-1, ground-bound, non-small, dismounted hero (the contest
// case).  RNG order matches C exactly: d(2,4) damage, rn1(4,4) trap duration,
// rn1/rn2 wounded-legs side+timeout, then exercise(A_DEX, FALSE).
async function trapeffect_bear_trap(trap, _trflags) {
    const u = game.u;
    const A_Your = trap.madeby_u ? 'Your' : 'A';
    const dmg = d(2, 4);
    // Levitation/Flying, amorphous/whirly/unsolid, and small-size harmless
    // branches are all false for the contest hero (a human Knight on foot).
    // C feeltrap(trap) just marks it seen for a sighted hero == seetrap().
    seetrap(trap);
    set_utrap(rn1(4, 4), TT_BEARTRAP);
    // Dismounted hero: "<A/Your> bear trap closes on your foot!"  Routed through
    // update_topl (C pline) so it leaves toplin == NEED_MORE; a same-turn
    // follow-up (the encumber_msg "slowed slightly" line when the wounded leg
    // pushes the hero over capacity) then pages it with --More-- (seed0004 step 27).
    const { update_topl } = await import('./display.js');
    await update_topl(`${A_Your} bear trap closes on your ${body_part(FOOT)}!`);
    // No iron shoes -> wounded legs + hp loss (Maybe_Half_Phys is identity for a
    // hero without HALF_PHDAM, i.e. every starting role).
    await set_wounded_legs(rn2(2) ? RIGHT_SIDE : LEFT_SIDE, rn1(10, 10));
    losehp(dmg);
    exercise(A_DEX, false);
}

// C ref: trap.c domagictrap() — the common (non-explosion) magic-trap effect.
// fate = rnd(20) selects the outcome.  The fate < 10 monster-summoning branch
// is ported faithfully (rnd(4) count, rn1(5,10) blindness, rn1(20,30) deafness,
// then `cnt` makemon calls); fates 12/19/20 still call out to machinery this
// port lacks and are listed in the per-arm comments below.
async function domagictrap() {
    const u = game.u;
    const fate = rnd(20);
    if (fate < 10) {
        /* Most of the time, it creates some monsters. */
        const cnt = rnd(4);
        // resists_blnd(&gy.youmonst) is (Blind || Unaware) for the hero plus
        // gaze/explosion-attack and Sunsword tests that a role monster fails —
        // so an ALREADY-blind hero skips the message AND the rn1(5,10).
        if (!Blind()) {
            await pline('You are momentarily blinded by a flash of light!');
            // make_blinded((long) rn1(5, 10), FALSE): SETS (not adds to) the
            // HBlinded timer, which timeout.js then counts down.  Leaving it
            // unset left every later `!Blind` test — display, observe_object,
            // monster sighting — answering for a sighted hero for 10..14 turns.
            u.blinded = rn1(5, 10);
            // potion.c toggle_blindness(): vision_full_recalc + an immediate
            // vision_recalc(0), same shape as apply.js use_cream_pie.  disp.botl
            // is DELIBERATELY not mirrored — every other blinding site in this
            // port (apply.js, eat.js) leaves the status release to the caller.
            game.vision_full_recalc = 1;
            const { vision_recalc } = await import('./vision.js');
            try { vision_recalc(0); } catch { /* pre-vision-init */ }
            // C then does `if (!Blind) Your1(vision_clears);` — Blind is now
            // TRUE, so no second line.
        }
        // else-if arm: `if (!Blind) You_see("a flash of light!")` — dead, since
        // resists_blnd() was only true BECAUSE the hero is blind.
        // Deafness: !Deaf for the contest hero.  HDeaf lives on u.uprops (that
        // is what sounds.js Deaf() and timeout.js's DEAF timer read).
        await pline('You hear a deafening roar!');
        if (!u.uprops) u.uprops = {};
        u.uprops.HDeaf = (u.uprops.HDeaf || 0) + rn1(20, 30); // incr_itimeout
        const { makemon } = await import('./makemon.js');
        for (let c = cnt; c-- > 0;)
            makemon(null, u.ux, u.uy, 0); // NO_MM_FLAGS
        // "roar: wake monsters in vicinity, AFTER placing trap-created ones".
        const { wake_nearto } = await import('./cmd.js');
        await wake_nearto(u.ux, u.uy, 7 * 7);
        return;
    }
    switch (fate) {
    case 10: /* sometimes nothing happens */
        break;
    case 11: /* toggle intrinsic invisibility */
        // !Invis for the contest hero -> self_invis_message(): "Gee!  All of
        // a sudden, you can't see yourself."  No RNG, but HInvis and the
        // hero's own glyph both change.
        // C ref: trap.c:5115 You_hear()/self_invis_message() are pline()s, which
        // page an unacknowledged topline with --More-- first; this port's bare
        // pline() setter never pages, so route both through update_topl().
        await update_topl('You hear a low hum.');
        await update_topl("Gee!  All of a sudden, you can't see yourself.");
        // HInvis = HInvis ? 0 : HInvis|FROMOUTSIDE.  Two fields: uprops.HInvis
        // is the intrinsic table (#wizintrinsic reads it), u.uinvis is what
        // monmove/mcastu Invis() actually test — a monster that cannot see the
        // hero picks different moduli (monmove.c:1860 rn2(11) etc.).
        if (!u.uprops) u.uprops = {};
        u.uprops.HInvis = u.uprops.HInvis ? 0 : ((u.uprops.HInvis || 0) | FROMOUTSIDE);
        u.uinvis = !!u.uprops.HInvis;
        newsym(u.ux, u.uy);
        break;
    case 12: /* a flash of fire */
        // GAP: dofiretrap(NULL) — d(2,4) twice, rn2(min(uhpmax,num+1)),
        // burnarmor()'s rn2(5) loop, rn2(3), destroy_items(AD_FIRE) and
        // burn_floor_objects().  burnarmor/destroy_items live unexported in
        // zap.js and burn_floor_objects has no port at all, so a partial
        // version here would desync just as hard as the omission.  Same
        // blocker as trapeffect_fire_trap.
        break;
    /* odd feelings */
    case 13:
        await pline(`A shiver runs up and down your ${body_part(SPINE)}!`);
        break;
    case 14:
        await pline('You hear distant howling.');
        break;
    case 15:
        // C: on the quest-start level "You feel [oddly ]like the prodigal
        // son."; otherwise "You suddenly yearn for your <nearby|distant>
        // homeland." — "nearby" inside the Quest or standing on its dungeon
        // entrance, else "distant".  No RNG, but a real topline either way.
        if (on_qstart_level())
            await pline(`You feel ${game.flags?.female ? 'oddly ' : ''}like the prodigal son.`);
        else
            await pline(`You suddenly yearn for your ${In_quest(u.uz) ? 'nearby' : 'distant'} homeland.`);
        break;
    case 16:
        await pline('Your pack shakes violently!');
        break;
    case 17:
        await pline('You smell charred flesh.');
        break;
    case 18:
        await pline('You feel tired.');
        break;
    case 19:
        // GAP: adjattrib(A_CHA, 1, FALSE) then tamedog() on the 3x3 box.
        // tamedog() draws (initedog/rn2 pacify rolls) and adjattrib prints
        // "You feel charismatic!"; neither is available in this port yet.
        break;
    case 20:
        // GAP: seffects(&pseudo) with a pseudo SPE_REMOVE_CURSE — uncurses
        // worn/wielded gear (and, for a Priest, everything).  read.js has no
        // seffects() entry point that takes a synthetic object.
        break;
    default:
        break;
    }
}

// C ref: dungeon.c on_level(&u.uz, &qstart_level) — is the hero standing on
// the level the Quest portal leads to?  game.qstart_level is filled in by
// dungeon.c's init; a port with no quest dungeon reports FALSE.
function on_qstart_level() {
    const uz = game.u?.uz, q = game.qstart_level;
    return !!uz && !!q && uz.dnum === q.dnum && uz.dlevel === q.dlevel;
}

// C ref: trap.c trapeffect_magic_trap(&youmonst, trap, trflags) — the hero
// steps onto a magic trap.  seetrap(); a 1-in-30 magical explosion (caught by
// !rn2(30)); otherwise domagictrap() picks the everyday effect.  steedintrap()
// follows but consumes no RNG for the dismounted contest hero.
async function trapeffect_magic_trap(trap, _trflags) {
    const u = game.u;
    seetrap(trap);
    if (!rn2(30)) {
        // Rare: magical explosion.  deltrap + losehp(rnd(10)) + uenmax bump.
        deltrap(trap);
        newsym(u.ux, u.uy);
        const { update_topl } = await import('./display.js');
        await update_topl('You are caught in a magical explosion!');
        game._toplin = 1;
        losehp(rnd(10));
        await update_topl('Your body absorbs some of the magical energy!');
        if (u) {
            u.uenmax = (u.uenmax || 0) + 2;
            u.uen = u.uenmax;
            if (u.uenpeak !== undefined && u.uenmax > u.uenpeak) u.uenpeak = u.uenmax;
        }
        return;
    }
    await domagictrap();
    // steedintrap(trap, NULL): no steed -> Trap_Effect_Finished, no RNG.
}

// C ref: dungeon.c ceiling(x,y).  Message text only, no RNG — but the terrain
// arm is NOT constant: C only says "ceiling" inside a room / on a wall / in a
// doorway, and says "rock cavern" everywhere else, which includes every plain
// CORRIDOR square.  A rock trap sprung in a corridor therefore reads "A trap
// door in the rock cavern opens ...".  The vault/temple/shop variants still
// need in_rooms(), which is stubbed empty across this port (mklev.js:254), so
// a rock trap inside a shop/temple under-reports as "ceiling".
function ceiling(x, y) {
    const typ = game.level?.at(x, y)?.typ ?? STONE;
    // Is_waterlevel/Is_firelevel/In_quest/Underwater and Is_earthlevel are all
    // unreachable for the levels this port generates.
    if (IS_AIR(typ)) return 'sky';
    if (IS_ROOM(typ) || IS_WALL(typ) || IS_DOOR(typ) || typ === SDOOR)
        return 'ceiling';
    return 'rock cavern';
}

// C ref: trap.c trapeffect_rocktrap(&youmonst, trap, trflags) — the hero
// variant.  On a first trigger trap->once is 0, so the "nothing falls out"
// escape short-circuits BEFORE its rn2(15) (C's && stops at trap->once).
// RNG order: d(2,6) damage FIRST, then t_missile's mksobj (next_ident rnd(2)
// + mksobj_init's GEM_CLASS rn1(6,6) quantity, which t_missile then overwrites
// with 1), then exercise(A_STR, FALSE)'s rn2(2).  losehp() draws nothing.
async function trapeffect_rocktrap(trap, _trflags) {
    const u = game.u;
    if (trap.once && trap.tseen && !rn2(15)) {
        await pline(`A trap door in the ${ceiling(u.ux, u.uy)} opens, but nothing falls out!`);
        deltrap(trap);
        newsym(u.ux, u.uy);
        return;
    }
    const dmg = d(2, 6);
    trap.once = 1;
    seetrap(trap); // C feeltrap(trap) == seetrap() for a sighted hero
    const otmp = t_missile(ROCK, trap);
    place_object(otmp, u.ux, u.uy);
    otmp.where = 'floor'; otmp.ox = u.ux; otmp.oy = u.uy;
    await pline(`A trap door in the ${ceiling(u.ux, u.uy)} opens and ${an(xname(otmp))} falls on your ${body_part(HEAD)}!`);
    // uarmh is null and passes_rocks(youmonst.data) is false for every role
    // monster (all MZ_HUMAN, no M1_PASSES_WALLS), so C's helmet / "passes
    // harmlessly through you" branches are unreachable and harmless stays FALSE.
    if (!Blind()) observe_object(otmp);
    const { stackobj } = await import('./invent.js');
    stackobj(otmp);
    newsym(u.ux, u.uy);
    // Maybe_Half_Phys is the identity for a hero without HALF_PHDAM.
    losehp(dmg);
    exercise(A_STR, false);
}

// ── shared helpers for the per-trap hero arms ────────────────────────────

// C ref: trap.c:1098 wearing_iron_shoes(mtmp) — boots whose material is IRON
// (both IRON_SHOES and KICKING_BOOTS are).  which_armor(&gy.youmonst, W_ARMF)
// is uarmf for the hero.
function wearing_iron_shoes_u() {
    const armf = game.uarmf;
    return !!armf && objects[armf.otyp]?.material === MAT_IRON;
}

// C ref: trap.c:3102 steedintrap(trap, otmp) — share the hero's trap with the
// steed.  Its first line is `if (!u.usteed) return Trap_Effect_Finished;` and
// u.usteed is null for every hero this port runs, so it draws nothing; named
// so the arms below read like the C and a steed port has one hook to fill.
function steedintrap(_trap, _otmp) {
    return false; /* Trap_Effect_Finished */
}

// C ref: trap.c:3883 selftouch(arg) — petrify a hero whose freed hands are
// holding a cockatrice corpse.  Nothing in this port puts one in uwep/uswapwep,
// and the function draws no RNG on any path (instapetrify -> done()).
function selftouch(_arg) { /* no wielded cockatrice corpse is reachable here */ }

// C ref: hack.h Role_if(PM_RANGER)/Role_if(PM_ROGUE) — js/roles.js's mnum, the
// 0-based role index C's urole.malenum is built from.
const ROLE_MNUM_RANGER = 7;
const ROLE_MNUM_ROGUE = 8;

// C ref: onames.h — objects.js indices for the trap-object conversions and the
// squeaky-board repair tools.
const BEARTRAP_OTYP = 244, LAND_MINE_OTYP = 243;
const POT_OIL_OTYP = 321;   // CAN_OF_GREASE_OTYP is js/trap.js:681
// C ref: objects.h body_part(ARM) index (const.js ARM is 0, the same slot).
const ARM_BP = ARM;

// C ref: dungeon.h Is_qlocate(lev) — the quest "locate" level.
function is_qlocate(uz) {
    const q = game.qlocate_level;
    return !!uz && !!q && uz.dnum === q.dnum && uz.dlevel === q.dlevel;
}

// C ref: trap.c:6516 count_traps(ttyp) — how many traps of one type the level
// carries.  monmove.c's WEB-avoidance modulus reads it.
export function count_traps(ttyp) {
    let ret = 0;
    for (const t of game.level?.traps ?? []) if (t.ttyp === ttyp) ret++;
    return ret;
}

// C ref: trap.c:6580 clear_conjoined_pits(trap) — drop `trap` out of its
// neighbours' conjoined masks.  deltrap() runs it before unlinking.
export function clear_conjoined_pits(trap) {
    if (!trap || !is_pit(trap.ttyp)) return;
    for (let diridx = 0; diridx < N_DIRS; diridx++) {
        if (!((trap.conjoined || 0) & (1 << diridx))) continue;
        const x = trap.tx + XDIR8[diridx], y = trap.ty + YDIR8[diridx];
        if (isok(x, y)) {
            const t = t_at(x, y);
            if (t && is_pit(t.ttyp))
                t.conjoined = (t.conjoined || 0) & ~(1 << ((diridx + 4) % N_DIRS));
        }
        trap.conjoined = (trap.conjoined || 0) & ~(1 << diridx);
    }
}

// C ref: trap.c:4010 fill_pit(x, y) — a boulder lying in a pit settles into it,
// removing both.  C goes through do.c flooreffects(otmp, x, y, "settle"), which
// this port does not have; that arm draws no RNG, so the removal is done here
// directly (the same shape as cmd.js's copy at climb_pit's call site).
export function fill_pit(x, y) {
    const t = t_at(x, y);
    if (!t || !(is_pit(t.ttyp) || is_hole(t.ttyp))) return;
    const otmp = sobj_at_floor(BOULDER, x, y);
    if (!otmp) return;
    const objs = game.level?.objects;
    if (objs) { const i = objs.indexOf(otmp); if (i >= 0) objs.splice(i, 1); }
    otmp.where = 'free';
    deltrap(t);
    newsym(x, y);
}

// C ref: trap.c:1825 trapeffect_pit(&gy.youmonst, trap, trflags) — the hero
// arm.  Draw order: the adj_pit debris rn2(5) (that arm only), set_utrap's
// rn1(6,2), then the damage rnd() and, in a spiked pit, the rn2(6) poison
// check.  hack.c climb_pit() (cmd.js) runs the per-turn escape afterwards.
async function trapeffect_pit(trap, trflags) {
    const u = game.u;
    const ttype = trap.ttyp;
    let relevant_spikes = (ttype === SPIKED_PIT);
    const plunged = (trflags & TOOKPLUNGE) !== 0;
    const viasitting = (trflags & VIASITTING) !== 0;
    const conj_pit = conjoined_pits(trap, t_at(u?.ux0 ?? 0, u?.uy0 ?? 0), true);
    const adj_pit = adj_nonconjoined_pit(trap);
    const already_known = !!trap.tseen;
    let deliberate = false;
    const Sokoban = !!game.level?.flags?.sokoban_rules;
    const Levitation = !!u?.uprops?.Levitation;
    const Flying = !!u?.uprops?.Flying;

    if (!Sokoban && (Levitation || (Flying && !plunged && !viasitting)))
        return;
    feeltrap(trap);
    // is_clinger(gy.youmonst.data) is FALSE for every role monster, so C's
    // "<A> pit opens up under you! / You don't fall in!" arm cannot fire.
    if (!Sokoban) {
        let verbbuf = '';
        // u.usteed is null, so C's two steed verbs are unreachable.
        if (game.iflags?.menu_requested && already_known) {
            await pline(`You carefully ${u_locomotion('lower yourself')} into the pit.`);
            deliberate = true;
        } else if (conj_pit) {
            await pline('You move into an adjacent pit.');
        } else if (adj_pit) {
            await pline(`You stumble over debris${!rn2(5) ? ' between the pits' : ''}.`);
        } else {
            verbbuf = !plunged ? 'fall' : (Flying ? 'dive' : 'plunge');
        }
        if (verbbuf)
            await pline(`You ${verbbuf} into ${a_your(trap.madeby_u)} pit!`);
    }
    /* wumpus reference */
    if (game.urole?.mnum === ROLE_MNUM_RANGER && !trap.madeby_u && !trap.once
        && In_quest(u?.uz) && is_qlocate(u?.uz)) {
        await update_topl('Fortunately it has a bottom after all...');
        trap.once = 1;
    }
    // u.umonnum == PM_PIT_VIPER / PM_PIT_FIEND needs a polymorphed hero
    // (js/hack.js keeps a ROLE index there while unpolymorphed), so the
    // "How pitiful" line cannot fire; it draws nothing either way.
    if (relevant_spikes && wearing_iron_shoes_u()) {
        await update_topl(`Your ${xname(game.uarmf)} protects you from the sharp iron spikes.`);
        relevant_spikes = false;
    } else if (relevant_spikes) {
        await update_topl(`You ${conj_pit ? 'step' : 'land'} on a set of sharp iron spikes!`);
    }
    set_utrap(rn1(6, 2), TT_PIT);
    if (!steedintrap(trap, null)) {
        // Maybe_Half_Phys is the identity for a hero without HALF_PHDAM.
        if (relevant_spikes) {
            const oldumort = u?.umortality | 0;
            losehp(rnd(conj_pit ? 4 : adj_pit ? 6 : 10));
            if (!rn2(6)) {
                const { poisoned } = await import('./attrib.js');
                await poisoned('spikes', A_STR,
                               (conj_pit || adj_pit || deliberate)
                                   ? 'stepping on poison spikes'
                                   : 'fall onto poison spikes',
                               ((u?.umortality | 0) > oldumort) ? 0 : 8, false);
            }
        } else if (!conj_pit && !deliberate && !(plunged && Flying)) {
            /* plunging flyers take spike damage but not pit damage */
            losehp(rnd(adj_pit ? 3 : 6));
        }
        // Punished is never set in this port -> no unplacebc/ballfall/placebc.
        if (!conj_pit) selftouch('Falling, you');
        game.vision_full_recalc = 1;
        exercise(A_STR, false);
        exercise(A_DEX, false);
    }
}

// C ref: dog.c next_to_u() — TRUE unless a LEASHED pet is more than one square
// away (an unleashed pet never blocks the fall; keepdogs() collects it).  This
// port has no leashes, so the answer is always TRUE — but the shape is kept so
// the "are jerked back by your pet!" arm exists for a leash port.
function next_to_u() {
    for (const m of game.level?.monsters ?? [])
        if (m.mleashed && distmin_(m.mx, m.my, game.u.ux, game.u.uy) > 1)
            return false;
    return true;
}

// C ref: trap.c:593 clamp_hole_destination(dlev) — a trap's recorded dst can
// point past the bottom of its own dungeon (bones from a differently sized
// game); never fall past it.
export function clamp_hole_destination(dlev) {
    const bottom = dng_bottom(dlev);
    if (dlev.dlevel > bottom) dlev.dlevel = bottom;
    return dlev;
}

// C ref: trap.c:602 fall_through(td, ftflags) — the hero drops a level through
// a trap door / hole (td) or through a hole just dug in the floor (!td).
// Draws no RNG itself; the arrival roll lives in do.c goto_level().
async function fall_through(td, ftflags) {
    const u = game.u;
    const Sokoban = !!game.level?.flags?.sokoban_rules;
    const Levitation = !!u?.uprops?.Levitation;
    const Flying = !!u?.uprops?.Flying;
    let dont_fall = null;
    let t = null;

    /* we'll fall even while levitating in Sokoban; otherwise, if we
       won't fall and won't be told that we aren't falling, give up now */
    if (Blind() && Levitation && !Sokoban) return;

    const newlevel = dunlev(u.uz) + 1;

    if (td) {
        t = t_at(u.ux, u.uy);
        feeltrap(t);
        if (!Sokoban && !(ftflags & TOOKPLUNGE)) {
            await pline(t.ttyp === TRAPDOOR
                ? 'A trap door opens up under you!'
                : "There's a gaping hole under you!");
            // C: pline() leaves toplin == TOPLINE_NEED_MORE, and goto_level()'s
            // docrt() -> display_nhwindow(WIN_MESSAGE) pages it with --More--
            // before the destination level is drawn.
            game._toplin = 1;
        }
    } else {
        await pline(`The ${surface(u.ux, u.uy)} opens up under you!`);
        game._toplin = 1;
    }

    if (Sokoban && Can_fall_thru(u.uz)) {
        /* KMH -- You can't escape the Sokoban level traps */
    } else if (Levitation || u.ustuck
               || (!Can_fall_thru(u.uz) && !game.level?.at(u.ux, u.uy)?.candig)
               // is_clinger / ceiling_hider are FALSE for every role monster.
               || (Flying && !(ftflags & TOOKPLUNGE))) {
        dont_fall = "don't fall in.";
    // gy.youmonst.data->msize is MZ_HUMAN for every role, so "don't fit
    // through." is unreachable while unpolymorphed.
    } else if (!next_to_u()) {
        dont_fall = 'are jerked back by your pet!';
    }
    if (dont_fall) {
        await update_topl(`You ${dont_fall}`);
        // NOT PORTED: impact_drop(0, u.ux, u.uy, 0) — objects on the square
        // fall through even though the hero did not (do.c, needs goto_level's
        // object migration).
        if (!td) {
            await topl_more();
            game._pending_message = '';
            await update_topl('The opening under you closes up.');
        }
        return;
    }
    // (Flying || is_clinger) && TOOKPLUNGE: no hero here flies into a plunge.
    // *u.ushops -> shopdig(1): shop damage bookkeeping is shk.c's, unported.

    let dtmp;
    if (Is_stronghold(u.uz)) {
        dtmp = find_hell();
    } else {
        if (t) {
            dtmp = { dnum: t.dst.dnum, dlevel: t.dst.dlevel };
            clamp_hole_destination(dtmp);
        } else {
            dtmp = { dnum: u.uz.dnum, dlevel: newlevel };
        }
        const dist = depth(dtmp) - depth(u.uz);
        if (dist > 1)
            await update_topl(`You fall down a ${dist > 3 ? 'very ' : ''}${dist > 2 ? 'deep ' : ''}shaft!`);
    }

    // C ref: do.c schedule_goto(&dtmp, !Flying ? UTOTYPE_FALLING : UTOTYPE_NONE,
    // NULL, !td ? msgbuf : NULL) — the level change is DEFERRED to
    // deferred_goto(), which allmain.js runs the moment rhack() returns.
    game._lvltport_dest = {
        newlevel: dtmp,
        post_msg: !td ? `The hole in the ${ceiling(u.ux, u.uy)} above you closes up.` : null,
        falling: !Flying,
    };
}

// C ref: trap.c:2013 trapeffect_hole(&gy.youmonst, trap, trflags) — HOLE and
// TRAPDOOR share this arm.
async function trapeffect_hole(trap, trflags) {
    const u = game.u;
    if (!Can_fall_thru(u.uz)) {
        seetrap(trap); /* normally done in fall_through */
        // C impossible("dotrap: %ss cannot exist on this level.") — a broken
        // invariant, not a game event; don't activate the trap after all.
        return;
    }
    await fall_through(true, (trflags & TOOKPLUNGE));
}

// C ref: objnam.c the(str) for the plain nouns dofiretrap/fall_through pass
// (surface() words and container xnames): the article rules for proper nouns
// and shop-owned items cannot apply to those.
function the_str(s) {
    return /^(the |a |an )/i.test(s) ? s : `the ${s}`;
}

// C ref: youprop.h Maybe_Half_Phys(dmg) — halved for a hero with HALF_PHDAM.
function Maybe_Half_Phys(dmg) {
    const u = game.u;
    return (u?.HHalf_physical_damage || u?.EHalf_physical_damage)
        ? Math.trunc((dmg + 1) / 2) : dmg;
}

// C ref: invent.c gi.invent — the hero's inventory chain.
function invent_list() {
    return Array.isArray(game.invent) ? game.invent : (game.gi?.invent || []);
}

// C ref: trap.c:2453 trapeffect_poly_trap(&gy.youmonst, trap, trflags).
async function trapeffect_poly_trap(trap, trflags) {
    const u = game.u;
    const viasitting = (trflags & VIASITTING) !== 0;

    seetrap(trap);
    // u.usteed is null, so C's "lead <steed> onto" verb is unreachable.
    const verbbuf = viasitting ? 'trigger' : `${u_locomotion('step')} onto`;
    await pline(`You ${verbbuf} a polymorph trap!`);
    if (wearing_iron_shoes_u()) {
        deltrap(trap);
        await update_topl(`Your ${xname(game.uarmf)} warps strangely.`);
        // NOT PORTED: poly_obj(uarmf, IRON_SHOES <-> KICKING_BOOTS) + prinv();
        // zap.c poly_obj() is a subsystem of its own and this arm needs a hero
        // wearing iron shoes, which no covered start does.
    } else if (u?.uprops?.Antimagic || u?.uprops?.Unchanging) {
        // shieldeff() draws nothing.
        await update_topl('You feel momentarily different.');
        /* Trap did nothing; don't remove it --KAA */
    } else {
        steedintrap(trap, null);
        deltrap(trap);      /* delete trap before polymorph */
        newsym(u.ux, u.uy); /* get rid of trap symbol */
        await update_topl('You feel a change coming over you.');
        const { polyself } = await import('./polyself.js');
        await polyself(POLY_NOFLAGS);
    }
}

// C ref: trap.c:2725 trapeffect_vibrating_square(&gy.youmonst, ...) — for the
// hero it is nothing but feeltrap(); the square is marked for later reference
// and the Book-of-the-Dead messages live in dungeon.c.
async function trapeffect_vibrating_square(trap, _trflags) {
    feeltrap(trap);
}

// C ref: dig.c:605 fillholetyp(x, y, fill_if_any) — what a new hole at <x,y>
// fills with, given its neighbours.  With no adjacent water or lava every arm
// short-circuits before its rn2(), so a dry square costs no draw.
// blow_up_landmine is currently the only caller.
//
// The lava arm is `(lava_cnt > moat+pool && rn2(lava_cnt+1))
//                  || (lava_cnt && fill_if_any)`.
// It was previously grouped as `(lava_cnt > moat+pool) && (rn2(..) ||
// fill_if_any)`, which is NOT the same expression: with fill_if_any set and
// lava present but outnumbered by water, C returns LAVAPOOL with no draw and
// the old form fell through to the MOAT arm and drew there.  (The moat and
// pool arms happen to be equivalent under either grouping.)
//
// Still approximate: the neighbour scan tests typ directly rather than C's
// is_moat/is_pool/is_lava, so a raised DRAWBRIDGE_UP always counts as moat
// (C splits it on drawbridgemask & DB_UNDER) and a Juiblex MOAT counts as
// moat rather than pool.  Both need levels the corpus never generates; the
// faithful predicates are exported from js/dbridge.js, but dbridge.js imports
// trap.js, so wiring them in means breaking that cycle first.
function fillholetyp(x, y, fill_if_any) {
    const lo_x = Math.max(1, x - 1), hi_x = Math.min(x + 1, 79);
    const lo_y = Math.max(0, y - 1), hi_y = Math.min(y + 1, 20);
    let pool_cnt = 0, moat_cnt = 0, lava_cnt = 0;
    for (let x1 = lo_x; x1 <= hi_x; x1++)
        for (let y1 = lo_y; y1 <= hi_y; y1++) {
            const typ = game.level?.at(x1, y1)?.typ;
            if (typ === POOL) pool_cnt++;
            else if (typ === MOAT || typ === WATER || typ === DRAWBRIDGE_UP) moat_cnt++;
            else if (typ === LAVAPOOL || typ === LAVAWALL) lava_cnt++;
        }
    if (!fill_if_any) pool_cnt = Math.trunc(pool_cnt / 3);
    if ((lava_cnt > moat_cnt + pool_cnt && rn2(lava_cnt + 1))
        || (lava_cnt && fill_if_any))
        return LAVAPOOL;
    if ((moat_cnt > 0 && rn2(moat_cnt + 1)) || (moat_cnt && fill_if_any))
        return MOAT;
    if ((pool_cnt > 0 && rn2(pool_cnt + 1)) || (pool_cnt && fill_if_any))
        return POOL;
    return ROOM;
}

// C ref: trap.c:3172 blow_up_landmine(trap) — the explosion itself.  scatter()
// is the RNG-heavy part; the tail converts the mine into a PIT (or floods it).
export async function blow_up_landmine(trap) {
    const x = trap.tx, y = trap.ty;
    const lev = game.level?.at(x, y);
    const { scatter } = await import('./explode.js');
    const { del_engr_at } = await import('./engrave.js');
    const { wake_nearto } = await import('./cmd.js');

    await scatter(x, y, 4, MAY_DESTROY | MAY_HIT | MAY_FRACTURE | VIS_EFFECTS, null);
    del_engr_at(x, y);
    await wake_nearto(x, y, 400);
    if (lev && IS_DOOR(lev.typ)) lev.doormask = D_BROKEN;
    // NOT PORTED: the drawbridge arm (dbridge.c destroy_drawbridge) — no
    // recorded landmine sits on or beside a drawbridge, and it draws nothing.

    trap = t_at(x, y); /* scatter() may have removed it */
    if (trap) {
        // Is_waterlevel/Is_airlevel are endgame-only; a landmine cannot be
        // generated there, so only the ordinary arm applies.
        const typ = fillholetyp(x, y, false);
        if (typ !== ROOM) {
            if (lev) lev.typ = typ;
            // NOT PORTED: mkmaze.c liquid_flow() — it deletes the trap and
            // drowns whatever is on the square (do.c flooreffects).
            deltrap(trap);
        } else {
            trap.ttyp = PIT;        /* explosion creates a pit */
            trap.madeby_u = 0;      /* resulting pit isn't yours */
            seetrap(trap);          /* and it isn't concealed */
        }
    }
    fill_pit(x, y);
    // NOT PORTED: maybe_dunk_boulders() / spot_checks() — terrain bookkeeping
    // for a square that just changed type; neither draws.
    recalc_block_point(x, y);
}

// C ref: trap.c:2528 trapeffect_landmine(&gy.youmonst, trap, trflags).
// Draw order: rnd(16) damage FIRST (before any message), then the airborne
// arm's rn2(3)s or the grounded arm's two rn1(35,41) wounded-leg timers, then
// blow_up_landmine()'s scatter().
let landmine_recursive = false;
async function trapeffect_landmine(trap, trflags) {
    const u = game.u;
    let damage = rnd(16);
    /* iron shoes protect against much of the damage from the explosion, but
       you still take some damage (and wound legs) */
    if (wearing_iron_shoes_u()) damage = Math.trunc((damage + 3) / 4);

    const already_seen = !!trap.tseen;
    const forcetrap = (trflags & FORCETRAP) !== 0 || (trflags & FAILEDUNTRAP) !== 0;
    const forcebungle = (trflags & FORCEBUNGLE) !== 0;

    if ((u?.uprops?.Levitation || u?.uprops?.Flying) && !forcetrap) {
        if (!already_seen && rn2(3)) return;
        feeltrap(trap);
        await pline(`${already_seen ? 'There is' : 'You discover'} ${
            trap.madeby_u ? 'the trigger of your mine' : 'a trigger'} in a pile of soil below you.`);
        if (already_seen && rn2(3)) return;
        await update_topl(`KAABLAMM!!!  ${forcebungle ? 'Your inept attempt sets'
            : 'The air currents set'} ${already_seen ? a_your(trap.madeby_u) : ''}${
            already_seen ? ' land mine' : 'it'} off!`);
    } else {
        /* prevent the mine from affecting the hero twice while the steed
           death path is still unwinding */
        if (landmine_recursive) return;
        feeltrap(trap);
        await pline(`KAABLAMM!!!  You triggered ${a_your(trap.madeby_u)} land mine!`);
        landmine_recursive = true;
        steedintrap(trap, null);
        landmine_recursive = false;
        // sobj_at(SADDLE, ...) / keep_saddle_with_steedcorpse(): steed-only.
        await set_wounded_legs(LEFT_SIDE, rn1(35, 41));
        await set_wounded_legs(RIGHT_SIDE, rn1(35, 41));
        exercise(A_DEX, false);
    }
    /* add a pit before calling losehp so bones won't keep the landmine;
       blow_up_landmine() will remove the pit afterwards if inappropriate */
    trap.ttyp = PIT;
    trap.madeby_u = 0;
    losehp(Maybe_Half_Phys(damage));
    await blow_up_landmine(trap);
    newsym(u.ux, u.uy); /* update trap symbol */
    /* fall recursively into the pit... */
    const t2 = t_at(u.ux, u.uy);
    if (t2) await dotrap(t2, RECURSIVETRAP);
    fill_pit(u.ux, u.uy);
}

// C ref: trap.c:726 animate_statue(statue, x, y, cause, fail_reason) — bring a
// statue to life.  Reduced to the path a mklev()-generated STATUE_TRAP can
// take: mk_trap_statue() builds the statue with mkcorpstat() and no omonst and
// no oname, so use_saved_traits (montraits()) and christen_monst() are both
// unreachable, and cause is always ANIMATE_NORMAL from a trap.
const AS_MON_IS_UNIQUE = 1, AS_NO_MON = 2;
export async function animate_statue(statue, x, y, _cause, fail_reason) {
    const mnum = statue.corpsenm;
    const mptr = monster_by_pmidx(mnum);
    // cant_revive() rewrites unique/were/zombie corpsenm; a trap statue is
    // built straight from rndmonst_adj(), so it is always revivable as itself.
    const mon = makemon(mptr, x, y, MM_NOMSG /* | NO_MINVENT */);
    if (!mon) {
        if (fail_reason)
            fail_reason.v = unique_corpstat(mptr) ? AS_MON_IS_UNIQUE : AS_NO_MON;
        return null;
    }
    // M_AP_TYPE/seemimic: a fresh makemon is not mimicking anything yet.
    mon.mundetected = false;
    mon.msleeping = 0;
    /* trap always releases a hostile monster */
    mon.mtame = 0;
    mon.mpeaceful = 0;
    // set_malign(mon) is alignment bookkeeping with no RNG.
    const comes_to_life = 'comes to life';
    if (x === game.u.ux && y === game.u.uy)
        await pline(`The statue ${comes_to_life}!`);
    else if (!Blind())
        await pline(`${an(pmname_of_pmidx(mnum))} ${comes_to_life}!`);
    // The statue's contents spill onto the floor and the statue is deleted.
    for (const o of (statue.cobj || [])) {
        o.ocontainer = null;
        place_object(o, x, y);
        o.where = 'floor'; o.ox = x; o.oy = y;
    }
    statue.cobj = [];
    delobj(statue);
    newsym(x, y);
    return mon;
}

// C ref: mondata.h unique_corpstat(ptr) — G_UNIQ generation flag.
function unique_corpstat(ptr) { return ((ptr?.geno | 0) & G_UNIQ) !== 0; }

// C ref: trap.c:908 activate_statue_trap(trap, x, y, shatter).
export async function activate_statue_trap(trap, x, y, shatter) {
    let otmp = sobj_at_floor(STATUE_OTYP, x, y);
    let mtmp = null;
    deltrap(trap);
    while (otmp) {
        const fail = { v: 0 };
        mtmp = await animate_statue(otmp, x, y, shatter ? 2 /*ANIMATE_SHATTER*/ : 0, fail);
        if (mtmp || fail.v !== AS_MON_IS_UNIQUE) break;
        otmp = sobj_at_floor(STATUE_OTYP, x, y);
    }
    newsym(x, y); /* feel_newsym() */
    return mtmp;
}

// C ref: trap.c:2279 trapeffect_statue_trap(&gy.youmonst, ...).
async function trapeffect_statue_trap(trap, _trflags) {
    const u = game.u;
    await activate_statue_trap(trap, u.ux, u.uy, false);
}

// C ref: trap.c:4233 dofiretrap(box) — box is null for the floor trap; the
// trapped-container caller (chest_trap) is pickup.c's and still unported.
// Draw order for an ordinary hero: d(2,4) [orig_dmg], the message, a SECOND
// d(2,4), rn2(min(uhpmax, num+1)) off uhpmax, then burnarmor()'s rn2(5) chain
// (or the rn2(3) that short-circuits it), destroy_items() and the floor burn.
export async function dofiretrap(box) {
    const u = game.u;
    const see_it = !Blind();
    let num = d(2, 4);
    const orig_dmg = num;
    const Fire_resistance = !!u?.uprops?.Fire_resistance;
    const noun = the_str(box ? xname(box) : surface(u.ux, u.uy));

    // C: `(box && !carried(box)) ? is_pool(box->ox, box->oy) : Underwater`.
    if ((box && !invent_list().includes(box)) ? isPoolAt(box.ox, box.oy) : !!u?.uinwater) {
        await pline(`A cascade of steamy bubbles erupts from ${noun}!`);
        if (Fire_resistance) await update_topl('You are uninjured.');
        else losehp(rnd(3));
        return;
    }
    await pline(`A ${TOWER_OF_FLAME} ${box ? 'bursts' : 'erupts'} from ${noun}!`);
    if (Fire_resistance) {
        // shieldeff()/monstseesu() draw nothing.
        num = rn2(2);
    } else if (u?.Upolyd) {
        let alt = 0;
        switch (u.umonnum) {
        case PM_PAPER_GOLEM:   alt = u.mhmax; break;
        case PM_STRAW_GOLEM:   alt = Math.trunc(u.mhmax / 2); break;
        case PM_WOOD_GOLEM:    alt = Math.trunc(u.mhmax / 4); break;
        case PM_LEATHER_GOLEM: alt = Math.trunc(u.mhmax / 8); break;
        default:               alt = 0; break;
        }
        if (alt > num) num = alt;
        if (u.mhmax > (monster_by_pmidx(u.umonnum)?.mlevel | 0)) {
            u.mhmax -= rn2(Math.min(u.mhmax, num + 1));
            game.botl = true;
        }
        if (u.mh > u.mhmax) { u.mh = u.mhmax; game.botl = true; }
    } else {
        const { minuhpmax, setuhpmax, losexp } = await import('./exper.js');
        const uhpmin = minuhpmax(1), olduhpmax = u.uhpmax;

        num = d(2, 4);
        if (u.uhpmax > uhpmin) {
            u.uhpmax -= rn2(Math.min(u.uhpmax, num + 1));
            game.botl = true;
        } /* note: no 'else' here */
        if (u.uhpmax < uhpmin) {
            setuhpmax(Math.min(olduhpmax, uhpmin));
            game.botl = true;
            if (!u.uprops?.Drain_resistance) await losexp(null);
        }
        if (u.uhp > u.uhpmax) { u.uhp = u.uhpmax; game.botl = true; }
    }
    if (!num) await update_topl('You are uninjured.');
    else losehp(num);
    // burn_away_slime(): the hero is never sliming in this port, and the
    // function draws no RNG.
    const { burnarmor, destroy_items, ignite_items, burn_floor_objects }
        = await import('./zap.js');
    if (await burnarmor(u) || rn2(3)) {
        await destroy_items(u, AD_FIRE, orig_dmg);
        await ignite_items(invent_list());
    }
    if (!box && burn_floor_objects(u.ux, u.uy, see_it, true) && !see_it)
        await update_topl('You smell paper burning.');
    // melt_ice(): the ICE terrain arm needs allmain.c's melting machinery; it
    // draws no RNG.
}

// C ref: trap.c:1730 trapeffect_fire_trap(&gy.youmonst, trap, trflags).
async function trapeffect_fire_trap(trap, _trflags) {
    seetrap(trap);
    await dofiretrap(null);
}

// ── the #untrap / disarm surface (trap.c:5248-6100) ──────────────────────

// C ref: hack.h MAXULEV — the highest experience level.
const MAXULEV = 30;
// C ref: monsym.h S_HUMAN — the '@' monster class.
const S_HUMAN_CLS = 25;
// C ref: obj.h Is_box(otmp).
function Is_box_otyp(otyp) { return otyp === LARGE_BOX || otyp === CHEST; }
// C ref: mondata.h mindless(ptr).
function mindless_pm(ptr) { return ((ptr?.mflags1 | 0) & M1_MINDLESS) !== 0; }
// C ref: mon.h helpless(mon) — can't act this turn.
function helpless_mon(mon) {
    return !mon?.mcanmove || !!mon?.msleeping || (mon?.mfrozen | 0) > 0;
}
// C ref: dungeon.c level_difficulty() — depth for an ordinary in-dungeon hero.
function level_difficulty() { return depth(game.u?.uz); }

// C ref: trap.c:5258 could_untrap(verbosely, check_floor) — the preliminary
// checks dountrap() and autounlock share.  webmaker() is a SPECIES test
// (PM_CAVE_SPIDER / PM_GIANT_SPIDER), not a flag — there is no M1_WEBMAKER.
export async function could_untrap(verbosely, check_floor) {
    const u = game.u;
    const data = u?.data;
    const { nohands } = await import('./monflags_data.js');
    const { near_capacity } = await import('./invent.js');
    const { can_reach_floor } = await import('./engrave.js');
    const webmaker = data?.name === 'cave spider' || data?.name === 'giant spider';
    let buf = '';

    if (near_capacity() >= 3 /* HVY_ENCUMBER */)
        buf = "You're too strained to do that.";
    else if ((data && nohands(data) && !webmaker) || !(data?.mmove ?? 12))
        buf = 'And just how do you expect to do that?';
    // u.ustuck / welded(uwep) && bimanual(uwep): neither is modelled here.
    else if (check_floor && !can_reach_floor(false))
        buf = `You can't reach the ${surface(u.ux, u.uy)}.`;
    if (buf) {
        if (verbosely) await pline(buf);
        return 0;
    }
    return 1;
}

// C ref: trap.c:5289 untrap_prob(ttmp) — 0 on success, non-0 on failure.
function untrap_prob(ttmp) {
    const u = game.u;
    let chance = 3;

    if (ttmp.ttyp === WEB) {
        // is_blade()/ART_STING/attacks(AD_FIRE) need the artifact + weapon
        // subsystems; a non-webmaker hero without a blade takes chance 7.
        const data = u?.data;
        const webmaker = data?.name === 'cave spider' || data?.name === 'giant spider';
        if (!webmaker) chance = 7; /* 5.0: used to be 30 */
    }
    if (u?.uprops?.Confusion || u?.uprops?.Hallucination) chance++;
    if (Blind()) chance++;
    if (u?.uprops?.Stunned) chance += 2;
    if (u?.HFumbling || u?.EFumbling) chance *= 2;
    /* Your own traps are better known than others. */
    if (ttmp.madeby_u) chance--;
    if (game.urole?.mnum === ROLE_MNUM_RANGER && ttmp.ttyp === BEAR_TRAP && chance <= 3)
        return 0; /* always succeeds */
    if (game.urole?.mnum === ROLE_MNUM_ROGUE) {
        if (rn2(2 * MAXULEV) < (u?.ulevel | 0)) chance--;
        if (u?.uhave?.questart && chance > 1) chance--;
    } else if (game.urole?.mnum === ROLE_MNUM_RANGER && chance > 1) {
        chance--;
    }
    if (chance < 1) chance = 1;
    return rn2(chance);
}

// C ref: trap.c:5341 cnv_trap_obj(otyp, cnt, ttmp, bury_it) — a disarmed trap
// becomes the object it was made of.
export function cnv_trap_obj(otyp, cnt, ttmp, bury_it) {
    const u = game.u;
    const otmp = mksobj(otyp, true, false);
    otmp.quan = cnt;
    otmp.owt = weight(otmp);
    /* Only dart traps are capable of being poisonous */
    if (otyp !== DART) otmp.opoisoned = 0;
    place_object(otmp, ttmp.tx, ttmp.ty);
    otmp.where = 'floor'; otmp.ox = ttmp.tx; otmp.oy = ttmp.ty;
    if (!bury_it) {
        // sellobj(): only for a trap the hero made inside a shop; shk.c's.
        stackobj_sync(otmp);
    }
    // bury_an_obj(): magical digging only; the burial subsystem is unported.
    newsym(ttmp.tx, ttmp.ty);
    if (u?.utrap && u.ux === ttmp.tx && u.uy === ttmp.ty) {
        u.utrap = 0; u.utraptype = 0; game.botl = true;   /* reset_utrap(TRUE) */
    }
    const mtmp = m_at(ttmp.tx, ttmp.ty);
    if (mtmp && mtmp.mtrapped) mtmp.mtrapped = 0;
    deltrap(ttmp);
}
function stackobj_sync(otmp) {
    import('./invent.js').then((m) => m.stackobj(otmp)).catch(() => {});
}

// C ref: trap.c:5393 move_into_trap(ttmp) — a failed disarm drags the hero
// onto the trap.  test_move()/drag_ball() are hack.c's; the only case this
// port can hit is an ordinary adjacent step, which always succeeds, so the
// "Fortunately, you don't move into it." arm needs a doorway/boulder squeeze
// that #untrap cannot reach from here.
async function move_into_trap(ttmp) {
    const u = game.u;
    const x = ttmp.tx, y = ttmp.ty;
    u.ux0 = u.ux; u.uy0 = u.uy;
    u.ux = x; u.uy = y;
    u.umoved = true;
    newsym(u.ux0, u.uy0);
    // vision_recalc(1) / check_leash(): display + leash bookkeeping, no RNG.
    /* marking the trap unseen forces dotrap() to treat it like a new
       discovery */
    ttmp.tseen = false;
    (game.iflags = game.iflags || {}).failing_untrap =
        (game.iflags.failing_untrap | 0) + 1;
    // C's spoteffects(TRUE) is pickup(1) + dotrap(); this port passes the
    // pickup as a callback (cmd.js's domove_core tail).
    const { pickup_after_move } = await import('./cmd.js');
    await spoteffects(pickup_after_move);
    game.iflags.failing_untrap--;
    const t2 = t_at(u.ux, u.uy);
    if (t2) t2.tseen = true;
    exercise(A_WIS, false);
}

// C ref: trap.c:5441 try_disarm(ttmp, force_failure).
// 0: doesn't even try; 1: tries and fails; 2: succeeds.
async function try_disarm(ttmp, force_failure) {
    const u = game.u;
    const mtmp = m_at(ttmp.tx, ttmp.ty);
    const ttype = ttmp.ttyp;
    const under_u = (!u.dx && !u.dy);
    const holdingtrap = (ttype === BEAR_TRAP || ttype === WEB);
    const { can_reach_floor } = await import('./engrave.js');

    /* Test for monster first, monsters are displayed instead of trap. */
    if (mtmp && (!mtmp.mtrapped || !holdingtrap)) {
        await pline(`${Monnam_trap(mtmp)} is in the way.`);
        return 0;
    }
    /* We might be forced to move onto the trap's location. */
    if (sobj_at_floor(BOULDER, ttmp.tx, ttmp.ty) && !u?.uprops?.Passes_walls
        && !under_u) {
        await pline('There is a boulder in your way.');
        return 0;
    }
    // The diagonal tight-space check duplicates hack.c test_move()'s bad_rock
    // pair; bad_rock() is cmd.js's and the squeeze needs two adjacent walls.
    /* untrappable traps are located on the ground. */
    if (!can_reach_floor(under_u)) {
        await pline(`You are unable to reach the ${trapname(ttype, false)}!`);
        return 0;
    }

    /* Will our hero succeed? */
    if (force_failure || untrap_prob(ttmp)) {
        if (rnl(5)) {
            await pline('Whoops...');
            if (mtmp) { /* must be a trap that holds monsters */
                if (ttype === BEAR_TRAP) {
                    const { abuse_dog } = await import('./uhitm.js');
                    if (mtmp.mtame) await abuse_dog(mtmp);
                    mtmp.mhp -= rnd(4);
                    if (mtmp.mhp <= 0) {
                        const { killed } = await import('./uhitm.js');
                        await killed(mtmp);
                    }
                } else if (ttype === WEB) {
                    let ttmp2 = t_at(u.ux, u.uy);
                    const data = u?.data;
                    const webmaker = data?.name === 'cave spider'
                        || data?.name === 'giant spider';
                    if (!webmaker && !rn2(3)
                        && (ttmp2 ? (ttmp2.ttyp === WEB)
                                  : !!(ttmp2 = maketrap(u.ux, u.uy, WEB)))) {
                        await update_topl("The web sticks to you.  You're caught too!");
                        await dotrap(ttmp2, NOWEBMSG);
                    }
                    if (mtmp.mtrapped)
                        await update_topl(`${Monnam_trap(mtmp)} remains entangled.`);
                }
            } else if (under_u) {
                await dotrap(ttmp, FAILEDUNTRAP);
            } else {
                await move_into_trap(ttmp);
            }
        } else {
            await pline(`${ttmp.madeby_u ? 'Your' : under_u ? 'This' : 'That'} ${
                trapname(ttype, false)} is difficult to ${
                (ttype === WEB) ? 'remove' : 'disarm'}.`);
        }
        return 1;
    }
    return 2;
}

// C ref: do_name.c Monnam(mtmp) — capitalised "the <mon>"; the trap arms only
// ever name a plain, seen monster.
function Monnam_trap(mtmp) {
    const nm = pmname_of_pmidx(mtmp?.pmidx ?? mtmp?.mnum ?? 0);
    return `The ${nm}`;
}

// C ref: trap.c:5530 reward_untrap(ttmp, mtmp) — freeing a monster from
// somebody else's trap may pacify it, and may please a lawful god.
async function reward_untrap(ttmp, mtmp) {
    if (ttmp.madeby_u) return;
    if (rnl(10) < 8 && !mtmp.mpeaceful && !helpless_mon(mtmp) && !mtmp.mfrozen
        && !mindless_pm(mtmp.data) && !unique_corpstat(mtmp.data)
        && mtmp.data?.mcls !== S_HUMAN_CLS) {
        mtmp.mpeaceful = 1;
        const { set_malign } = await import('./makemon.js');
        set_malign(mtmp);
        await pline(`${Monnam_trap(mtmp)} is grateful.`);
    }
    /* Helping someone out of a trap is a nice thing to do. */
    if (!rn2(3) && !rnl(8) && (game.u?.ualign?.type | 0) === 1 /* A_LAWFUL */) {
        const { adjalign } = await import('./attrib.js');
        adjalign(1);
        await update_topl('You feel that you did the right thing.');
    }
}

// C ref: trap.c:5553 disarm_holdingtrap(ttmp) — bear trap or web.
async function disarm_holdingtrap(ttmp) {
    const u = game.u;
    const which = ttmp.madeby_u ? 'your' : 'the';
    const fails = await try_disarm(ttmp, false);
    if (fails < 2) return fails;

    const mtmp = m_at(ttmp.tx, ttmp.ty);
    if (mtmp) {
        mtmp.mtrapped = 0;
        await pline(`You extract ${mon_nam_trap(mtmp)} from ${which} ${
            (ttmp.ttyp === BEAR_TRAP) ? 'bear trap' : 'web'}.`);
        await reward_untrap(ttmp, mtmp);
    } else if (ttmp.ttyp === BEAR_TRAP) {
        await pline(`You disarm ${which} bear trap.`);
        cnv_trap_obj(BEARTRAP_OTYP, 1, ttmp, false);
    } else if (ttmp.ttyp === WEB) {
        // is_blade()/artifact webs need the weapon subsystem; a bare-handed
        // hero always gets the plain removal line.
        await pline(`You succeed in removing ${which} web.`);
        deltrap(ttmp);
    }
    newsym(u.ux + u.dx, u.uy + u.dy);
    return 1;
}

// C ref: do_name.c mon_nam(mtmp).
function mon_nam_trap(mtmp) {
    return `the ${pmname_of_pmidx(mtmp?.pmidx ?? mtmp?.mnum ?? 0)}`;
}

// C ref: trap.c:5594 disarm_landmine(ttmp).
async function disarm_landmine(ttmp) {
    const fails = await try_disarm(ttmp, false);
    if (fails < 2) return fails;
    await pline(`You disarm ${ttmp.madeby_u ? 'your' : 'the'} land mine.`);
    cnv_trap_obj(LAND_MINE_OTYP, 1, ttmp, false);
    return 1;
}

// C ref: trap.c:5607 unsqueak_ok(obj) — getobj filter for the grease/oil the
// squeaky-board repair wants.
function unsqueak_ok(obj) {
    if (!obj) return 0;                       /* GETOBJ_EXCLUDE */
    if (obj.otyp === CAN_OF_GREASE_OTYP) return 2;  /* GETOBJ_SUGGEST */
    if (obj.otyp === POT_OIL_OTYP && obj.dknown
        && objects[POT_OIL_OTYP]?.oc_name_known) return 2;
    if (obj.oclass === POTION_CLASS) return 1;      /* GETOBJ_DOWNPLAY */
    return 0;
}

// C ref: trap.c:5630 disarm_squeaky_board(ttmp).
async function disarm_squeaky_board(ttmp) {
    const u = game.u;
    const { getobj, useup, makeknown, consume_obj_charge } = await import('./invent.js');
    const obj = await getobj('untrap with', unsqueak_ok, 1 /* GETOBJ_PROMPT */);
    if (!obj) return 0;

    const bad_tool = !!obj.cursed
        || ((obj.otyp !== POT_OIL_OTYP || obj.lamplit)
            && (obj.otyp !== CAN_OF_GREASE_OTYP || !obj.spe));
    const fails = await try_disarm(ttmp, bad_tool);
    if (fails < 2) return fails;

    if (obj.otyp === CAN_OF_GREASE_OTYP) consume_obj_charge(obj, true);
    else { useup(obj); makeknown(POT_OIL_OTYP); }
    await pline('You repair the squeaky board.'); /* no madeby_u */
    deltrap(ttmp);
    newsym(u.ux + u.dx, u.uy + u.dy);
    const { more_experienced, newexplevel } = await import('./exper.js');
    more_experienced(1, 5);
    await newexplevel();
    return 1;
}

// C ref: trap.c:5664 disarm_shooting_trap(ttmp, otyp).
async function disarm_shooting_trap(ttmp, otyp) {
    const fails = await try_disarm(ttmp, false);
    if (fails < 2) return fails;
    await pline(`You disarm ${ttmp.madeby_u ? 'your' : 'the'} trap.`);
    cnv_trap_obj(otyp, 50 - rnl(50), ttmp, false);
    return 1;
}

// C ref: trap.c:5677 try_lift(mtmp, ttmp, xtra_wt, stuff).
async function try_lift(mtmp, ttmp, xtra_wt, stuff) {
    const { calc_capacity } = await import('./invent.js');
    if (calc_capacity(xtra_wt) >= 3 /* HVY_ENCUMBER */) {
        await pline(`${Monnam_trap(mtmp)} is ${
            stuff ? 'carrying too much' : 'too heavy'} for you to lift.`);
        if (!ttmp.madeby_u && !mtmp.mpeaceful && mtmp.mcanmove
            && !mindless_pm(mtmp.data) && mtmp.data?.mcls !== S_HUMAN_CLS
            && rnl(10) < 3) {
            mtmp.mpeaceful = 1;
            const { set_malign } = await import('./makemon.js');
            set_malign(mtmp);
            await update_topl(`${Monnam_trap(mtmp)} thinks it was nice of you to try.`);
        }
        return 0;
    }
    return 1;
}

// C ref: trap.c:5700 help_monster_out(mtmp, ttmp) — pull a monster out of a pit.
async function help_monster_out(mtmp, ttmp) {
    const { near_capacity } = await import('./invent.js');

    if (!mtmp.mtrapped) {
        await pline(`${Monnam_trap(mtmp)} isn't trapped.`);
        return 0;
    }
    /* check_capacity(0) */
    if (near_capacity() >= 4 /* EXT_ENCUMBER */) {
        await pline("You can't do that while carrying so much stuff.");
        return 1;
    }
    const uprob = untrap_prob(ttmp);
    if (uprob && !helpless_mon(mtmp)) {
        await pline(`You try to reach out your ${body_part(ARM_BP)}s, but ${
            mon_nam_trap(mtmp)} backs away skeptically.`);
        return 1;
    }
    // touch_petrifies() cockatrice arm needs polymon()/instapetrify(); no
    // recorded pit holds a cockatrice.
    if (uprob) {
        await pline(`You try to grab ${mon_nam_trap(mtmp)}, but cannot get a firm grasp.`);
        if (mtmp.msleeping) {
            mtmp.msleeping = 0;
            await update_topl(`${Monnam_trap(mtmp)} awakens.`);
        }
        return 1;
    }
    await pline(`You reach out your ${body_part(ARM_BP)}s and grab ${mon_nam_trap(mtmp)}.`);
    if (mtmp.msleeping) {
        mtmp.msleeping = 0;
        await update_topl(`${Monnam_trap(mtmp)} awakens.`);
    } else if (mtmp.mfrozen && !rn2(mtmp.mfrozen)) {
        mtmp.mcanmove = 1;
        mtmp.mfrozen = 0;
        await update_topl(`${Monnam_trap(mtmp)} stirs.`);
    }
    let xtra_wt = mtmp.data?.cwt | 0;
    if (!await try_lift(mtmp, ttmp, xtra_wt, false)) return 1;
    if (mtmp.minvent?.length) {
        for (const o of mtmp.minvent) xtra_wt += (o.owt | 0);
        if (!await try_lift(mtmp, ttmp, xtra_wt, true)) return 1;
    }
    await pline(`You pull ${mon_nam_trap(mtmp)} out of the pit.`);
    mtmp.mtrapped = 0;
    await reward_untrap(ttmp, mtmp);
    fill_pit(mtmp.mx, mtmp.my);
    return 1;
}

// C ref: trap.c:6294 chest_trap(obj, bodypart, disarm) — a trapped container
// goes off.  Returns TRUE if the container itself was destroyed.
// Draw order: the luck save (rn2(13 + Luck), then rn2(13) for its message) or
// the effect selector (rn2(20), then rn2(13 - Luck) or rn2(26)), then the arm.
// dokick.js / pickup.js / extcmd-handlers.js each carry a "chest_trap() is not
// ported" comment at their own call sites; this is the function they want.
export async function chest_trap(obj, bodypart, disarm) {
    const u = game.u;
    const Luck = u?.uluck | 0;

    obj.tknown = 0;   /* for xname(); set to 1 below */
    obj.otrapped = 0; /* one-shot; clear first in case the chest kills you */
    await pline(disarm ? 'You set it off!' : 'You trigger a trap!');
    await topl_more();               /* display_nhwindow(WIN_MESSAGE, FALSE) */
    game._pending_message = '';
    if (Luck > -13 && rn2(13 + Luck) > 7) { /* saved by luck */
        let msg;
        switch (rn2(13)) {
        case 12: case 11: msg = 'explosive charge is a dud'; break;
        case 10: case 9:  msg = 'electric charge is grounded'; break;
        case 8:  case 7:  msg = 'flame fizzles out'; break;
        case 6:  case 5: case 4: msg = 'poisoned needle misses'; break;
        default:          msg = 'gas cloud blows away'; break;
        }
        await pline(`But luckily the ${msg}!`);
    } else {
        const sel = rn2(20) ? ((Luck >= 13) ? 0 : rn2(13 - Luck)) : rn2(26);
        const { poisoned } = await import('./attrib.js');
        if (sel >= 21) {
            const ox = obj.ox, oy = obj.oy;
            // NOT PORTED: the shop arms (costly_spot/stolen_value/
            // make_angry_shk) and unpunish() for a ball/chain on the spot.
            await pline(`The ${xname(obj)} explodes!`);
            obj.cobj = [];                            /* delete_contents() */
            let chestgone = false;
            for (const o of [...(game.level?.objects || [])])
                if (o.where === 'floor' && o.ox === ox && o.oy === oy) {
                    if (o === obj) chestgone = true;
                    delobj(o);
                }
            const { wake_nearby } = await import('./cmd.js');
            await wake_nearby(false);
            losehp(Maybe_Half_Phys(d(6, 6)));
            exercise(A_STR, false);
            if (chestgone) return true;
        } else if (sel >= 17) {
            await pline(`A cloud of noxious gas billows from ${the_str(xname(obj))}.`);
            if (rn2(3)) {
                await poisoned('gas cloud', A_STR, 'cloud of poison gas', 15, false);
            } else {
                const { create_gas_cloud } = await import('./region.js');
                await create_gas_cloud(obj.ox, obj.oy, 1, 8);
            }
            exercise(A_CON, false);
        } else if (sel >= 13) {
            await pline(`You feel a needle prick your ${body_part(bodypart)}.`);
            await poisoned('needle', A_CON, 'poisoned needle', 10, false);
            exercise(A_CON, false);
        } else if (sel >= 9) {
            await dofiretrap(obj);
        } else if (sel >= 6) {
            let dmg = d(4, 4);
            const orig_dmg = dmg;
            await pline('You are jolted by a surge of electricity!');
            if (u?.uprops?.Shock_resistance) {
                await update_topl("You don't seem to be affected.");
                dmg = 0;
            }
            const { destroy_items } = await import('./zap.js');
            await destroy_items(u, AD_ELEC, orig_dmg);
            if (dmg) losehp(dmg);
        } else if (sel >= 3) {
            if (!u?.uprops?.Free_action) {
                await pline('Suddenly you are frozen in place!');
                const { nomul } = await import('./hack.js');
                nomul(-d(5, 6));
                game.multi_reason = 'frozen by a trap';
                exercise(A_DEX, false);
            } else {
                await pline('You momentarily stiffen.');
            }
        } else {
            const { rndcolor } = await import('./do_name.js');
            await pline(`A cloud of ${rndcolor()} gas billows from ${the_str(xname(obj))}.`);
            if (!u?.uprops?.Stun)
                await update_topl('You stagger and your vision blurs...');
            // make_stunned(x, FALSE) / make_hallucinated(x, FALSE, 0) — the
            // silent form is just the timer; potion.js exports the latter.
            u.uprops = u.uprops || {};
            u.uprops.Stun = ((u.uprops.Stun | 0) & TIMEOUT) + rn1(7, 16);
            u.Stunned = true;
            const { make_hallucinated } = await import('./potion.js');
            await make_hallucinated(((u.uprops.Hallucination | 0) & TIMEOUT) + rn1(5, 16),
                                    false, 0);
        }
        const { bot } = await import('./display.js');
        await bot(); /* to get immediate botl re-display */
    }
    obj.tknown = 1; /* hero knows chest is no longer trapped */
    return false;
}

// C ref: trap.c:5794 disarm_box(box, force, confused).
async function disarm_box(box, force, confused) {
    const u = game.u;
    if (box.otrapped) {
        let ch = acurr_eff(A_DEX) + (u.ulevel | 0);
        if (game.urole?.mnum === ROLE_MNUM_ROGUE) ch *= 2;
        if (!force && (confused || u?.HFumbling || u?.EFumbling
                       || rnd(75 + Math.trunc(level_difficulty() / 2)) > ch)) {
            await chest_trap(box, FINGER, true);
        } else {
            await pline('You disarm it!');
            box.otrapped = 0;
            box.tknown = 1;
            const { more_experienced, newexplevel } = await import('./exper.js');
            more_experienced(8, 0);
            await newexplevel();
        }
        exercise(A_DEX, true);
    } else {
        await pline(`That ${xname(box)} was not trapped.`);
        box.tknown = 0;
    }
}

// C ref: trap.c:5821 untrap_box(box, force, confused).
async function untrap_box(box, force, confused) {
    const u = game.u;
    const { ynq } = await import('./invent.js');
    if ((box.otrapped
         && (force || (!confused && rn2(MAXULEV + 1 - (u.ulevel | 0)) < 10)))
        || box.tknown
        || (!force && confused && !rn2(3))) {
        if (!(box.tknown && box.dknown))
            await pline(`You find a trap on ${the_str(xname(box))}!`);
        else
            await pline(`There's a trap on ${the_str(xname(box))}.`);
        box.tknown = 1;
        observe_object(box);
        if (!confused) exercise(A_WIS, true);
        if (await ynq('Disarm it?') === 'y')
            await disarm_box(box, force, confused);
    } else {
        await pline(`You find no traps on ${the_str(xname(box))}.`);
    }
}

// C ref: trap.c:5848 untrap(force, rx, ry, container) — the direction has
// already been read by extcmd-handlers.js's dountrap() (C reads it here), so
// this takes the resolved square.  Returns 1 if the attempt took time.
export async function untrap_at(x, y, force) {
    const u = game.u;
    const { can_reach_floor } = await import('./engrave.js');
    const confused = !!(u?.uprops?.Confusion || u?.uprops?.Hallucination);
    let trap_skipped = false;

    let ttmp = t_at(x, y);
    if (ttmp && !ttmp.tseen) ttmp = null;
    const trapdescr = ttmp ? trapname(ttmp.ttyp, false) : null;
    const here = (x === u.ux && y === u.uy);

    let boxcnt = 0;
    if (here)
        for (const o of (game.level?.objects || []))
            if (o.where === 'floor' && o.ox === x && o.oy === y
                && Is_box_otyp(o.otyp) && ++boxcnt > 1) break;

    let deal_with_floor_trap = can_reach_floor(false);
    if (!deal_with_floor_trap) {
        let the_trap = '';
        if (ttmp) the_trap += an(trapdescr);
        if (ttmp && boxcnt) the_trap += ' and ';
        if (boxcnt) the_trap += (boxcnt === 1) ? 'a container' : 'containers';
        const useplural = ((ttmp && boxcnt > 0) || boxcnt > 1);
        if (ttmp || boxcnt)
            await pline(`There ${useplural ? 'are' : 'is'} ${the_trap} ${
                here ? 'here' : 'there'} but you can't reach ${
                useplural ? 'them' : 'it'}.`);
        trap_skipped = !!ttmp;
    } else if (ttmp) {
        const the_trap = the_str(trapdescr);
        if (boxcnt) {
            if (is_pit(ttmp.ttyp)) {
                await pline(`You can't do much about ${the_trap}${
                    u.utrap ? " that you're stuck in"
                            : ' while standing on the edge of it'}.`);
                trap_skipped = true;
                deal_with_floor_trap = false;
            } else {
                const { ynq } = await import('./invent.js');
                const c = await ynq(`There ${(boxcnt === 1) ? 'is a container'
                    : 'are containers'} and ${an(trapdescr)} here.  ${
                    (ttmp.ttyp === WEB) ? 'Remove' : 'Disarm'} ${the_trap}?`);
                if (c === 'q') return 0;
                if (c === 'n') { trap_skipped = true; deal_with_floor_trap = false; }
            }
        }
        if (deal_with_floor_trap) {
            if (u.utrap) {
                await pline(`You cannot deal with ${the_trap} while trapped${
                    here ? ' in it' : ''}!`);
                return 1;
            }
            // M_AP_FURNITURE/M_AP_OBJECT mimics: stumble_onto_mimic() is
            // uhitm.c's; no recorded trap square holds a disguised mimic.
            const mtmp = m_at(x, y);
            switch (ttmp.ttyp) {
            case BEAR_TRAP:
            case WEB:
                return await disarm_holdingtrap(ttmp);
            case LANDMINE:
                return await disarm_landmine(ttmp);
            case SQKY_BOARD:
                return await disarm_squeaky_board(ttmp);
            case DART_TRAP:
                return await disarm_shooting_trap(ttmp, DART);
            case ARROW_TRAP:
                return await disarm_shooting_trap(ttmp, ARROW);
            case PIT:
            case SPIKED_PIT:
                if (here) {
                    await pline('You are already on the edge of the pit.');
                    return 0;
                }
                if (!mtmp) {
                    await pline('Try filling the pit instead.');
                    return 0;
                }
                return await help_monster_out(mtmp, ttmp);
            default:
                await pline(`You cannot disable ${!here ? 'that' : 'this'} trap.`);
                return 0;
            }
        }
    }
    // C ref: trap.c:5998 — at most one container per move may be checked.
    if (deal_with_floor_trap && boxcnt) {
        const { ynq } = await import('./invent.js');
        for (const otmp of (game.level?.objects || [])) {
            if (!(otmp.where === 'floor' && otmp.ox === x && otmp.oy === y
                  && Is_box_otyp(otmp.otyp))) continue;
            const q = (otmp.tknown && otmp.dknown)
                ? `Disarm this ${xname(otmp)}?`
                : `There is ${an(xname(otmp))} here.  Check it for traps?`;
            const c = await ynq(q);
            if (c === 'q') return 0;
            if (c === 'y') {
                if (otmp.tknown && otmp.dknown) await disarm_box(otmp, force, confused);
                else await untrap_box(otmp, force, confused);
                return 1; /* even for 'no' at the "Disarm it?" prompt */
            }
            /* 'n' => continue to the next box */
        }
        await pline('There are no other chests or boxes here.');
    }
    // stumble_on_door_mimic(): a mimic disguised as a door is uhitm.c's.

    const loc = game.level?.at(x, y);
    if (!IS_DOOR(loc?.typ ?? STONE)) {
        if (!trap_skipped) await pline('You know of no traps there.');
        return 0;
    }
    const dm = loc.doormask | 0;
    if (dm === D_NODOOR || dm === 0) {
        await pline(`You ${Blind() ? 'feel' : 'see'} no door there.`);
        return 0;
    }
    if (dm & D_ISOPEN) { await pline('This door is safely open.'); return 0; }
    if (dm & D_BROKEN) { await pline('This door is broken.'); return 0; }

    if (((dm & D_TRAPPED) !== 0
         && (force || (!confused && rn2(MAXULEV - (u.ulevel | 0) + 11) < 10)))
        || (!force && confused && !rn2(3))) {
        await pline('You find a trap on the door!');
        exercise(A_WIS, true);
        const { ynq } = await import('./invent.js');
        if (await ynq('Disarm it?') !== 'y') return 1;
        if (dm & D_TRAPPED) {
            const ch = 15 + ((game.urole?.mnum === ROLE_MNUM_ROGUE)
                ? (u.ulevel | 0) * 3 : (u.ulevel | 0));
            exercise(A_DEX, true);
            if (!force && (confused || u?.HFumbling || u?.EFumbling
                           || rnd(75 + Math.trunc(level_difficulty() / 2)) > ch)) {
                await pline('You set it off!');
                const { b_trapped } = await import('./cmd.js');
                await b_trapped('door', FINGER);
                loc.doormask = D_NODOOR;
                const { unblock_point } = await import('./vision.js');
                unblock_point(x, y);
                newsym(x, y);
                // add_damage(): shop repair bookkeeping, no RNG.
            } else {
                await pline('You disarm it!');
                loc.doormask = dm & ~D_TRAPPED;
                const { more_experienced, newexplevel } = await import('./exper.js');
                more_experienced(8, 0);
                await newexplevel();
            }
        } else {
            await pline('This door was not trapped.');
        }
        return 1;
    }
    await pline('You find no traps on the door.');
    return 1;
}

// C ref: trap.c trapeffect_selector() — dispatch on trap type (hero variant).
// Still incomplete; the arms C has that this port does not are listed with
// their blocker so the next completeness pass can pick them up:
//   HOLE/TRAPDOOR      fall_through() -> goto_level()
//   TELEP_TRAP         tele_trap() -> tele()/level_tele()
//   MAGIC_PORTAL       domagicportal() -> goto_level()
//   STATUE_TRAP        activate_statue_trap() -> animate_statue()
//   POLY_TRAP          polyself()
//   LANDMINE           blow_up_landmine() -> scatter()/fill_pit()
//   ROLLING_BOULDER_TRAP  launch_obj()
//   FIRE_TRAP          dofiretrap()  [see domagictrap fate 12]
//   PIT/SPIKED_PIT     needs hack.c climb_pit()'s per-turn rn2(2) too (cmd.js
//                      climb_pit_min() is a no-op), and SPIKED_PIT needs
//                      poisoned(); falling in without those desyncs on the
//                      NEXT turn instead of this one
// Everything unlisted falls through to seetrap() so the trap is at least
// revealed (C would trapeffect_* it; VIBRATING_SQUARE really is just feeltrap).
async function trapeffect_selector(trap, trflags) {
    switch (trap.ttyp) {
    case ARROW_TRAP:
        await trapeffect_arrow_trap(trap, trflags);
        break;
    case SQKY_BOARD:
        await trapeffect_sqky_board(trap, trflags);
        break;
    case SLP_GAS_TRAP:
        await trapeffect_slp_gas_trap(trap, trflags);
        break;
    case WEB:
        await trapeffect_web(trap, trflags);
        break;
    case ROCKTRAP:
        await trapeffect_rocktrap(trap, trflags);
        break;
    case RUST_TRAP:
        await trapeffect_rust_trap(trap, trflags);
        break;
    case BEAR_TRAP:
        await trapeffect_bear_trap(trap, trflags);
        break;
    case DART_TRAP:
        await trapeffect_dart_trap(trap, trflags);
        break;
    case MAGIC_TRAP:
        await trapeffect_magic_trap(trap, trflags);
        break;
    case ANTI_MAGIC:
        await trapeffect_anti_magic(trap, trflags);
        break;
    case TELEP_TRAP:
        await trapeffect_telep_trap(trap, trflags);
        break;
    case LEVEL_TELEP:
        await trapeffect_level_telep(trap, trflags);
        break;
    case ROLLING_BOULDER_TRAP:
        await trapeffect_rolling_boulder_trap(trap, trflags);
        break;
    case PIT:
    case SPIKED_PIT:
        await trapeffect_pit(trap, trflags);
        break;
    case HOLE:
    case TRAPDOOR:
        await trapeffect_hole(trap, trflags);
        break;
    case FIRE_TRAP:
        await trapeffect_fire_trap(trap, trflags);
        break;
    case LANDMINE:
        await trapeffect_landmine(trap, trflags);
        break;
    case POLY_TRAP:
        await trapeffect_poly_trap(trap, trflags);
        break;
    case STATUE_TRAP:
        await trapeffect_statue_trap(trap, trflags);
        break;
    case VIBRATING_SQUARE:
        await trapeffect_vibrating_square(trap, trflags);
        break;
    default:
        // Not yet modeled: reveal the trap but don't simulate its effect.
        seetrap(trap);
        break;
    }
}

// C ref: trap.c:2070 trapeffect_telep_trap(&youmonst, ...) — the hero branch:
// seetrap() then tele_trap().
async function trapeffect_telep_trap(trap, _trflags) {
    seetrap(trap);
    await tele_trap(trap);
}

// C ref: teleport.c:1491 tele_trap(trap).  The trap->once arm is the vault
// teleporter makevtele() plants (mklev.c makeniche sets ttmp->once on it): a
// one-shot that deletes itself and drops the hero INSIDE the vault, which is
// the only way a normal game reaches a vault at all.
let in_tele_trap = false;
async function tele_trap(trap) {
    if (in_tele_trap) return;
    in_tele_trap = true;
    const u = game.u;
    // C: noteleport_level(&gy.youmonst) — the hero is neither covetous nor a
    // demon lord, so it reduces to the level flag.
    if (In_endgame(u?.uz) || u?.uprops?.Antimagic || game.level?.flags?.noteleport) {
        await update_topl('You feel a wrenching sensation.');
    } else if (trap.once) {
        deltrap(trap);
        newsym(u.ux, u.uy); /* get rid of trap symbol */
        await vault_tele();
    } else if (trap.teledest && isok(trap.teledest.x, trap.teledest.y)) {
        const { teleds_hero } = await import('./read.js');
        const { settrack } = await import('./track.js');
        let mtmp = m_at(trap.teledest.x, trap.teledest.y);
        settrack();
        if (mtmp) {
            const { enexto_spawn } = await import('./makemon.js');
            const cc = enexto_spawn(mtmp.mx, mtmp.my, mtmp.data);
            if (!cc) {
                await update_topl('You shudder for a moment.');
            } else {
                const { rloc_to } = await import('./teleport.js');
                await rloc_to(mtmp, cc.x, cc.y);
                mtmp = null;
            }
        }
        if (!mtmp) await teleds_hero(trap.teledest.x, trap.teledest.y);
    } else {
        const { scrolltele } = await import('./read.js');
        await scrolltele(null); /* teleport.c tele() */
    }
    in_tele_trap = false;
}

// C ref: teleport.c:772 vault_tele() — search_special(VAULT) then a
// somexyspace() spot inside it.  The two rn2(2)s this draws (a vault is 2x2)
// are seed0012's step 237.
async function vault_tele() {
    const { teleok_hero, teleds_hero } = await import('./read.js');
    const { somexyspace } = await import('./mkroom.js');
    const croom = search_special(VAULT);
    const c = { x: 0, y: 0 };
    if (croom && somexyspace(croom, c) && teleok_hero(c.x, c.y, false)) {
        await teleds_hero(c.x, c.y); /* TELEDS_TELEPORT */
        return;
    }
    const { scrolltele } = await import('./read.js');
    await scrolltele(null);
}

// C ref: mkroom.c:765 search_special(type) — first room (then subroom) whose
// rtype matches.  ANY_TYPE/ANY_SHOP are not needed by the callers here.
function search_special(type) {
    for (const croom of (game.level?.rooms || []))
        if (croom.rtype === type) return croom;
    for (const croom of (game.level?.subrooms || []))
        if (croom.rtype === type) return croom;
    return null;
}

// C ref: trap.c:2087 trapeffect_level_telep(&youmonst, ...) — the hero branch:
// seetrap() then level_tele_trap().
async function trapeffect_level_telep(trap, trflags) {
    seetrap(trap);
    await level_tele_trap(trap, trflags);
}

// C ref: teleport.c:1537 level_tele_trap(trap, trflags).
async function level_tele_trap(trap, trflags) {
    const u = game.u;
    let intentional = false;
    let verbbuf;
    if ((trflags & (VIASITTING | FORCETRAP)) !== 0) {
        verbbuf = 'trigger';
        intentional = true;
    } else {
        verbbuf = `${u_locomotion('step')} onto`;
    }
    await update_topl(`You ${verbbuf} a level teleport trap!`);

    // Antimagic (shieldeff has no RNG) and In_endgame both abort before the
    // deltrap, leaving the trap in place.
    const antimagic = !!(u?.uprops?.Antimagic);
    if ((antimagic && !intentional) || In_endgame(u?.uz)) {
        await update_topl('You feel a wrenching sensation.');
        return;
    }
    deltrap(trap);
    newsym(u.ux, u.uy);
    const { level_tele } = await import('./do.js');
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    await level_tele((q) => hooked_tty_getlin(q, null));

    const teleport_control = (u?.uprops?.Teleport_control || 0) > 0 || !!u?.Teleport_control;
    const hallu = (u?.uprops?.Hallucination || 0) > 0;
    if (hallu || teleport_control)
        await update_topl(`You briefly feel ${hallu ? 'oriented' : 'centered'}.`);
    else
        await update_topl(`You feel ${(u?.uprops?.Confusion || 0) > 0 ? 'even more ' : ''}disoriented.`);
    // C ref: teleport.c:1568 — confusion is applied AFTER the teleport attempt,
    // because being confused changes level_tele's "Oops..." outcome.
    if (!teleport_control) {
        const cur = (u?.uprops?.Confusion || 0);
        if (!u.uprops) u.uprops = {};
        u.uprops.Confusion = cur + 3;
        u.uconf = true;
    }
}

// C ref: trap.c:2346 trapeffect_anti_magic(&youmonst, ...) — the hero branch.
// The positively-enchanted-iron-shoes bypass (trap.c:2330) and the Antimagic
// arm (which rolls rnd(4) for implosion damage) both need gear no covered hero
// wears, so this is the plain energy-drain path.
async function trapeffect_anti_magic(trap, _trflags) {
    const u = game.u;
    seetrap(trap);
    let drain = d(2, 6);                       // trap.c:2386
    const halfd = rnd(Math.trunc(drain / 2));  // trap.c:2387 — UNCONDITIONAL
    let exclaim_it = false;
    if ((u.uenmax ?? 0) > drain) {
        u.uenmax -= halfd;
        drain -= halfd;
        exclaim_it = true;
    }
    await drain_en(drain, exclaim_it);
}

// C ref: trap.c:5195 drain_en(n, max_already_drained).  The throttle
// `if (n > (uen + uenmax) / 3) n = rnd(n)` is a real draw, and so is the
// `uenmax -= rnd(-uen)` overdraw.
async function drain_en(n, max_already_drained) {
    const u = game.u;
    let punct = max_already_drained ? '!' : '.';
    let mesg;
    if ((u.uenmax ?? 0) < 1) {
        if (u.uen || u.uenmax) { u.uen = 0; u.uenmax = 0; }
        mesg = 'momentarily lethargic';
    } else {
        if (n > Math.trunc(((u.uen ?? 0) + u.uenmax) / 3)) n = rnd(n);  // trap.c:5222
        mesg = 'your magical energy drain away';
        if (n > (u.uen ?? 0)) punct = '!';
        u.uen = (u.uen ?? 0) - n;
        if (u.uen < 0) {
            u.uenmax -= rnd(-u.uen);
            if (u.uenmax < 0) u.uenmax = 0;
            u.uen = 0;
        } else if (u.uen > u.uenmax) {
            u.uen = u.uenmax;
        }
    }
    await pline(`You feel ${mesg}${punct}`);
}

// C ref: trap.c floor_trigger(ttyp) — a trap set off by weight on the floor, so
// an airborne hero passes over it without triggering it.
function floor_trigger(ttyp) {
    switch (ttyp) {
    case ARROW_TRAP: case DART_TRAP: case ROCKTRAP: case SQKY_BOARD:
    case BEAR_TRAP: case LANDMINE: case ROLLING_BOULDER_TRAP:
    case SLP_GAS_TRAP: case RUST_TRAP: case FIRE_TRAP:
    case PIT: case SPIKED_PIT: case HOLE: case TRAPDOOR:
        return true;
    default:
        return false;
    }
}

// C ref: trap.c check_in_air(&gy.youmonst, trflags) — hero variant.  A role
// monster is neither is_floater nor is_flyer, so C's `is_you ? Levitation :
// is_floater(...)` reduces to the hero's own Levitation/Flying properties.
function check_in_air_u(trflags) {
    const u = game.u;
    const plunged = (trflags & (TOOKPLUNGE | VIASITTING)) !== 0;
    return (trflags & HURTLING) !== 0
        || !!u?.uprops?.Levitation
        || (!!u?.uprops?.Flying && !plunged);
}

// C ref: hack.c u_locomotion(def) — locomotion(gy.youmonst.data, def) returns
// `def` unchanged for every role monster (none is a flyer/floater/clinger/
// swimmer/crawler), so only Levitation and Flying change the verb.
function u_locomotion(def) {
    const u = game.u;
    const cap = def[0] === def[0].toUpperCase();
    if (u?.uprops?.Levitation) return cap ? 'Float' : 'float';
    if (u?.uprops?.Flying) return cap ? 'Fly' : 'fly';
    return def;
}

// C ref: trap.c a_your[]/A_Your[] — indexed by trap->madeby_u.
function a_your(madeby_u) { return madeby_u ? 'your' : 'a'; }

// C ref: trap.c trapname(ttyp, force_pit).  Hallucination is never set in this
// port (see cmd.js avoid_trap_andor_region), so the roletrap/halu_trapnames
// arms are dead and the result is always the defsym explanation.
function trapname(ttyp, _force_pit) { return trap_explanation(ttyp); }

// C ref: trap.c dotrap()'s article for the "step over"/"escape" lines — an
// arrow trap the hero did not make reads "an arrow trap".
function trap_article(trap) {
    return (trap.ttyp === ARROW_TRAP && !trap.madeby_u) ? 'an' : a_your(trap.madeby_u);
}

// C ref: trap.h fixed_tele_trap(t) — a teleport trap with a fixed destination
// (sp_lev "teleport_region"); triggering it is never left to chance.
function fixed_tele_trap(t) {
    return t.ttyp === TELEP_TRAP && !!t.teledest
        && isok(t.teledest.x, t.teledest.y);
}

// C ref: cmd.c xytodir(x,y) — index of a unit step in xdir[]/ydir[], else
// DIR_ERR.  hack.h DIR_180(dir) is ((dir) + 4) % N_DIRS.
function xytodir(dx, dy) {
    for (let i = 0; i < N_DIRS; i++)
        if (XDIR8[i] === dx && YDIR8[i] === dy) return i;
    return -1; /* DIR_ERR */
}

// C ref: trap.c conjoined_pits(trap2, trap1, u_entering_trap2) — do the two
// pits share the wall the hero is crossing?  `conjoined` is only ever set by
// dig.c's pit digging, which this port does not model, so the answer is FALSE
// in practice; kept faithful because dotrap()/trapeffect_pit() use it to
// SUPPRESS RNG draws, so a wrong TRUE here would eat rolls C makes.
export function conjoined_pits(trap2, trap1, u_entering_trap2) {
    const u = game.u;
    if (!trap1 || !trap2) return false;
    if (!isok(trap2.tx, trap2.ty) || !isok(trap1.tx, trap1.ty)
        || !is_pit(trap2.ttyp) || !is_pit(trap1.ttyp)
        || (u_entering_trap2 && !(u?.utrap && u.utraptype === TT_PIT)))
        return false;
    const diridx = xytodir(Math.sign(trap2.tx - trap1.tx),
                           Math.sign(trap2.ty - trap1.ty));
    if (diridx !== -1) {
        const adjidx = (diridx + 4) % N_DIRS;
        if (((trap1.conjoined || 0) & (1 << diridx))
            && ((trap2.conjoined || 0) & (1 << adjidx)))
            return true;
    }
    return false;
}

// C ref: trap.c adj_nonconjoined_pit(adjtrap) — is the hero stepping from one
// pit straight into a neighbouring, unjoined one?
function adj_nonconjoined_pit(adjtrap) {
    const u = game.u;
    const trap_with_u = t_at(u?.ux0 ?? 0, u?.uy0 ?? 0);
    if (trap_with_u && adjtrap && u?.utrap && u.utraptype === TT_PIT
        && is_pit(trap_with_u.ttyp) && is_pit(adjtrap.ttyp))
        return xytodir(u.dx, u.dy) !== -1;
    return false;
}

// C ref: trap.c dotrap(trap, trflags) — the hero steps onto / triggers a trap.
export async function dotrap(trap, trflags = 0) {
    if (!trap) return;
    const u = game.u;
    const ttype = trap.ttyp;
    const already_seen = !!trap.tseen;
    let forcetrap = (trflags & FORCETRAP) !== 0 || (trflags & FAILEDUNTRAP) !== 0;
    const forcebungle = (trflags & FORCEBUNGLE) !== 0;
    const plunged = (trflags & TOOKPLUNGE) !== 0;
    const conj_pit = conjoined_pits(trap, t_at(u?.ux0 ?? 0, u?.uy0 ?? 0), true);
    const adj_pit = adj_nonconjoined_pit(trap);

    trap_nomul();

    if (fixed_tele_trap(trap)) { trflags |= FORCETRAP; forcetrap = true; }

    if (game.level?.flags?.sokoban_rules && (is_pit(ttype) || is_hole(ttype))) {
        // Sokoban pits/holes are inescapable: C skips BOTH the airborne
        // step-over and the rn2(5) escape roll, so this arm must not draw.
        await pline(`Air currents pull you down into ${a_your(trap.madeby_u)} ${trapname(ttype, true)}!`);
    } else if (!forcetrap) {
        if (floor_trigger(ttype) && check_in_air_u(trflags)) {
            if (already_seen)
                await pline(`You ${u_locomotion('step')} over ${trap_article(trap)} ${trapname(ttype, false)}.`);
            return;
        }
        // C's escape roll is gated on a stack of conditions our old port
        // dropped: an already-seen MAGIC_PORTAL / VIBRATING_SQUARE /
        // ANTI_MAGIC draws NO rn2(5) at all, and neither does a Fumbling,
        // bungling, plunging or pit-to-pit step.  is_clinger(gy.youmonst.data)
        // is false for every role monster, so the `||` arm cannot fire.
        const fumbling = !!(u?.HFumbling || u?.EFumbling);
        if (already_seen && !fumbling && !undestroyable_trap(ttype)
            && ttype !== ANTI_MAGIC && !forcebungle && !plunged
            && !conj_pit && !adj_pit
            && !rn2(5)) {
            await pline(`You escape ${trap_article(trap)} ${trapname(ttype, false)}.`);
            return;
        }
    }

    // u.usteed is null for the contest hero, so mon_learns_traps(u.usteed, ...)
    // is skipped.  mons_see_trap() draws no RNG but WRITES mtrapseen on every
    // sighted, non-mindless, non-animal onlooker — which monmove's mfndpos then
    // reads to route around the trap, and mon_mintrap's already-seen rn2(4)
    // step-over roll depends on.
    const { mons_see_trap } = await import('./monmove.js');
    mons_see_trap(trap);

    await trapeffect_selector(trap, trflags);
}

// C ref: include/trap.h is_pit(ttyp) — PIT or SPIKED_PIT.
function is_pit_ttyp(ttyp) { return ttyp === PIT || ttyp === SPIKED_PIT; }

// C ref: dbridge.c is_pool(x,y) — POOL/MOAT/WATER.  IS_POOL(typ) (the range
// macro, POOL..DRAWBRIDGE_UP) coincides with this for every terrain the
// corpus ever generates (no drawbridges), so it's reused directly.
function isPoolAt(x, y) {
    const loc = game.level?.at(x, y);
    return !!loc && IS_POOL(loc.typ);
}

// C ref: mkobj.c sobj_at(otyp, x, y) — floor object lookup (matches cmd.js
// boulder_at's flat game.level.objects scan).
function sobj_at_floor(otyp, x, y) {
    let found = null;
    for (const o of (game.level?.objects || []))
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === otyp)
            found = o;
    return found;
}

// C ref: pager.c waterbody_name(x,y) — non-hallucinating water-body name; the
// special-level and hallucination variants aren't reached by the corpus.
function waterbody_name(x, y) {
    const loc = game.level?.at(x, y);
    const typ = loc ? loc.typ : STONE;
    if (typ === LAVAPOOL) return 'molten lava';
    if (typ === MOAT) return 'moat';
    if (typ === WATER) return 'wall of water';
    if (typ === LAVAWALL) return 'wall of lava';
    return 'pool of water';
}

// C ref: hack.c doorless_door() — a doorway that lacks its door (NODOOR or
// BROKEN); all rogue-level doors are treated as doored.
function doorless_door(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc || !IS_DOOR(loc.typ)) return false;
    if (Is_rogue_level(game.u?.uz)) return false;
    return !((loc.doormask || 0) & ~(D_NODOOR | D_BROKEN));
}

// C ref: teleport.c goodpos(x,y,&youmonst,0), specialized for a hero with no
// Swimming/Amphibious/Levitation/Flying/water-or-lava-walking (the only case
// the corpus reaches): a pool or lava square is never "good", nor is a
// monster-occupied, boulder-covered, or inaccessible one.
export function goodpos_for_hero(x, y) {
    if (!isok(x, y)) return false;
    if (m_at(x, y)) return false;
    const loc = game.level?.at(x, y);
    const typ = loc ? loc.typ : STONE;
    if (IS_POOL(typ) || IS_LAVA(typ)) return false;
    if (!ACCESSIBLE(typ)) return false;
    if (sobj_at_floor(BOULDER, x, y)) return false;
    return true;
}

// C ref: hack.c crawl_destination(x,y) — used by drown() to check whether the
// hero can crawl from water to <x,y>.  The diagonal squeeze-through check
// (bad_rock/cant_squeeze_thru) isn't reached by the corpus (the hero is a
// normal, unencumbered human), so a diagonal step is allowed once the door
// restriction clears.
function crawl_destination(x, y) {
    if (!goodpos_for_hero(x, y)) return false;
    const u = game.u;
    if (x === u.ux || y === u.uy) return true; // orthogonal: unrestricted
    const loc = game.level?.at(x, y);
    if (loc && IS_DOOR(loc.typ) && !doorless_door(x, y)) return false;
    return true;
}

// C ref: trap.c rnd_nextto_goodpos(&x,&y,&youmonst) — shuffle the 8 compass
// directions (Fisher-Yates, matching C's dirs[] shuffle exactly so the PRNG
// stream lines up) and return the first neighbor that passes
// crawl_destination(), or null if none do.
const CRAWL_XDIR = [-1, -1, 0, 1, 1, 1, 0, -1];
const CRAWL_YDIR = [0, -1, -1, -1, 0, 1, 1, 1];
function rnd_nextto_goodpos_hero(x0, y0) {
    const dirs = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = N_DIRS; i > 0; i--) {
        const j = rn2(i);
        const k = dirs[j];
        dirs[j] = dirs[i - 1];
        dirs[i - 1] = k;
    }
    for (let i = 0; i < N_DIRS; i++) {
        const nx = x0 + CRAWL_XDIR[dirs[i]];
        const ny = y0 + CRAWL_YDIR[dirs[i]];
        if (crawl_destination(nx, ny)) return { x: nx, y: ny };
    }
    return null;
}

// C ref: trap.c emergency_disrobe() — sheds items until unencumbered enough to
// crawl out.  The corpus hero is always unencumbered at this point in the
// tutorial (near_capacity() == UNENCUMBERED), so the shedding loop never
// actually runs; that loop itself isn't modelled.
function emergency_disrobe_min() {
    return near_capacity() <= SLT_ENCUMBER;
}

// C ref: teleport.c teleds(nux,nuy,flags) — relocate the hero.  Punished/
// swallowed/vault-guard handling isn't reached by the corpus (a fresh
// Tenderfoot crawling out of a tutorial pool), so only the position update,
// vision refresh, and the re-entrant spoteffects(TRUE) at the new spot are
// modelled.
async function teleds_min(nux, nuy, pickupFn) {
    const u = game.u;
    const { vision_recalc } = await import('./vision.js');
    const oldx = u.ux, oldy = u.uy;
    u.ux0 = oldx;
    u.uy0 = oldy;
    u.ux = nux;
    u.uy = nuy;
    newsym(oldx, oldy);
    vision_recalc(1);
    newsym(nux, nuy);
    await spoteffects(pickupFn);
}

// C ref: trap.c drown() — the hero falls into water.  Swimming/Amphibious/
// Breathless/steed/teleport-intrinsic/the death loop aren't reached by the
// corpus (a non-swimming Tenderfoot who successfully crawls out on the first
// attempt), so only that successful-crawl-out path is modelled.
async function drown(pickupFn) {
    const u = game.u;
    const loc = game.level?.at(u.ux, u.uy);
    const isSolid = !!loc && loc.typ === WATER; // is_waterwall(u.ux,u.uy)
    await update_topl(`You ${isSolid ? 'plunge' : 'fall'} into the ${waterbody_name(u.ux, u.uy)}!`);
    if (!isSolid) await update_topl('You sink like a rock.');

    const spot = rnd_nextto_goodpos_hero(u.ux, u.uy);
    if (spot) {
        const succ = emergency_disrobe_min();
        await update_topl('You try to crawl out of the water.');
        if (succ) {
            await update_topl('Pheew!  That was close.');
            await teleds_min(spot.x, spot.y, pickupFn);
            return true;
        }
        await update_topl('But in vain.');
    }
    // The repeated-drowning/death loop isn't reached by the corpus.
    return true;
}

// C ref: trap.c lava_effects() — the hero (no Fire_resistance, no Wwalking:
// the only case the corpus reaches) falls into lava and burns.  d(6,6) is
// rolled unconditionally (it's only ever USED on the Wwalking branch, but C
// declares/rolls it up front regardless), then usurvive is false, so no
// "bursts into flame" messages print (those are gated on usurvive) and the
// invent-burn loop runs silently; the covered heroes carry nothing at this
// point (Tutorial mode sequesters invent — see allmain.js
// sequester_inventory_for_tutorial), so that loop is a no-op here.  Ends in
// done(BURNING); no return when the hero really dies (matches C's
// really_done() never returning to the caller).
async function lava_effects() {
    const u = game.u;
    const { topl_more } = await import('./display.js');
    d(6, 6); // dmg; only consulted by the Wwalking branch, not reached here
    await update_topl(`You fall into the ${waterbody_name(u.ux, u.uy)}!`);
    game._killer_name = 'burned by molten lava';
    // C ref: hack.c urgent_pline() — pline() immediately followed by a forced
    // --More--; concatenates onto the still-pending fall-in line (same as any
    // other pline), then flushes the joint line.
    await update_topl('You burn to a crisp...');
    await topl_more();
    game._toplin = 0;
    game._pending_message = '';
    const { done } = await import('./end.js');
    await done(BURNING);
}

// C ref: hack.c pooleffects(newspot) — entering/leaving water or lava.  Only
// the "hero (no steed, no Levitation/Flying) walks onto a plain pool or into
// lava" branches are modelled; leaving water/lava and the steed/Wwalking
// paths aren't reached by the corpus.
async function pooleffects_enter(pickupFn) {
    const u = game.u;
    if (u.ustuck || u.uprops?.Levitation || u.uprops?.Flying) return false;
    if (u.usteed) return false;
    const loc = game.level?.at(u.ux, u.uy);
    const typ = loc ? loc.typ : STONE;
    if (!isPoolAt(u.ux, u.uy) && !IS_LAVA(typ)) return false;
    if (IS_LAVA(typ)) { await lava_effects(); return true; }
    return drown(pickupFn);
}

// C ref: hack.c spoteffects() — run the per-square effects after the hero
// arrives on a new tile.  pooleffects(TRUE) runs FIRST; if it reports the
// hero fell in and was relocated, the rest of spoteffects (pickup/trap) is
// skipped for this square, matching C's `goto spotdone`.  The full C routine
// also handles special rooms, sinks and ice; none of those consume PRNG in
// the owned sessions, so this port covers the pool/pickup/trap ordering (the
// part that matters):
//
//   if (pooleffects(TRUE)) goto spotdone;
//   pit = (trap && is_pit(trap->ttyp));
//   if (pick && !pit) pickup(1);     // pickup BEFORE a non-pit trap
//   if (trap) dotrap(trap, ...);
//   if (pick && pit) pickup(1);      // pickup AFTER a pit trap
//
// `pickupFn` is the caller's pickup(1) (cmd.js pickup_after_move), called
// with the CURRENT hero position (not fixed coordinates) so a re-entrant
// call from teleds_min() picks up at the square the hero actually lands on;
// it is optional so older call sites (with no auto-pickup) still trigger
// traps.
export async function spoteffects(pickupFn) {
    const u = game.u;
    if (!u) return;
    if (await pooleffects_enter(pickupFn)) return;
    // C ref: hack.c spoteffects() — check_special_room(FALSE) runs right after
    // pooleffects(), i.e. BEFORE the trap and the pickup.
    await check_special_room(false);
    const trap = t_at(u.ux, u.uy);
    const pit = !!(trap && is_pit_ttyp(trap.ttyp));
    if (pickupFn && !pit) await pickupFn(u.ux, u.uy);
    if (trap) await dotrap(trap, 0);
    if (pickupFn && pit) await pickupFn(u.ux, u.uy);
}

// ── rolling boulder trap (hero) ──────────────────────────────────────────────
// C ref: trap.c:2560 trapeffect_rolling_boulder_trap() + trap.c:3260 launch_obj().
// The trap used to fall into dotrap()'s `default:` (seetrap only), so the
// boulder never moved and thitu()'s rnd(20) was never drawn.
const ROLL = 0x0100, LAUNCH_UNSEEN = 0x0200, LAUNCH_KNOWN = 0x0400;

function feeltrap(trap) { if (!trap) return; trap.tseen = true; newsym(trap.tx, trap.ty); }
function sgn_(n) { return n > 0 ? 1 : (n < 0 ? -1 : 0); }
function distmin_(x0, y0, x1, y1) {
    const dx = Math.abs(x0 - x1), dy = Math.abs(y0 - y1);
    return dx > dy ? dx : dy;
}
// (sobj_at_floor is js/trap.js:1692 — note it returns the LAST match on the
// square, where C's sobj_at() returns the head of the nexthere chain.)

async function trapeffect_rolling_boulder_trap(trap, _trflags) {
    const style = ROLL | (trap.tseen ? LAUNCH_KNOWN : 0);
    feeltrap(trap);
    await pline('Click!  You trigger a rolling boulder trap!');
    game._toplin = 1;
    const r = await launch_obj(BOULDER, trap.launch.x, trap.launch.y,
                               trap.launch2.x, trap.launch2.y, style);
    if (!r) {
        if (style & LAUNCH_KNOWN) await pline('No boulder was released.');
        else await pline('Fortunately for you, no boulder was released.');
    }
}

// NOT modelled (each is a clean divergence, not a silent desync): the
// ohitmon() monster-in-path arm and the boulder-hits-boulder arm of
// trap.c:3319.  Everything that draws RNG on the hero's own path is here.
async function launch_obj(otyp, x1, y1, x2, y2, style) {
    const u = game.u;
    const { thitu } = await import('./monmove.js');
    const { dmgval } = await import('./uhitm.js');
    let otmp = sobj_at_floor(otyp, x1, y1);
    let otherside = false;
    if (!otmp && otyp === BOULDER) { otherside = true; otmp = sobj_at_floor(otyp, x2, y2); }
    if (!otmp) return 0;
    if (otherside) { const tx = x1, ty = y1; x1 = x2; y1 = y2; x2 = tx; y2 = ty; }
    let singleobj;
    if ((otmp.quan || 1) === 1) {
        const arr = game.level.objects; const ix = arr.indexOf(otmp);
        if (ix >= 0) arr.splice(ix, 1);
        otmp.where = 'free';
        singleobj = otmp;
    } else {
        singleobj = { ...otmp, quan: 1 }; otmp.quan -= 1;
    }
    newsym(x1, y1);
    let dist = distmin_(x1, y1, x2, y2);
    let x = x1, y = y1;
    const dx = sgn_(x2 - x1), dy = sgn_(y2 - y1);
    if (style & LAUNCH_KNOWN) { singleobj.otrapped = 1; style &= ~LAUNCH_KNOWN; }
    style &= ~LAUNCH_UNSEEN;
    while (dist-- > 0) {
        if (!isok(x + dx, y + dy)) { x2 = x; y2 = y; break; }
        x += dx; y += dy;
        if (m_at(x, y)) break;                       // ohitmon(): unported
        if (u && u.ux === x && u.uy === y) {
            const dam = dmgval(singleobj, { data: { msize: 0 } });
            await thitu(9 + (singleobj.spe || 0), dam, singleobj);
        }
        if (dist > 0 && isok(x + dx, y + dy)) {
            const typ = game.level?.at(x + dx, y + dy)?.typ;
            if (IS_STWALL(typ) || IS_TREE(typ)) { x2 = x; y2 = y; await pline('Thump!'); break; }
        }
    }
    singleobj.otrapped = 0;
    place_object(singleobj, x2, y2);
    newsym(x2, y2);
    return 1;
}
