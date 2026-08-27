// wizterrainwish.js — the wizard-mode "wish for terrain" arm of readobjnam().
//
// C ref: src/objnam.c:3554 wizterrainwish() (reached from readobjnam()'s
// `wiztrap:` label at objnam.c:4976) plus objnam.c:3539 set_wallprop_from_str()
// and objnam.c:3919 dbterrainmesg().
//
// Split out of js/readobjnam.js the way C splits it out of readobjnam(): the
// hook there is three lines.  readobjnam() is synchronous while this port's
// pline() is not, so the messages are pushed onto an `out` array for the
// caller to print; every RNG draw still happens in place, in C's order.
//
// The only RNG in the whole function is the altar branch's
//   al = !rn2(6) ? A_NONE : (rn2(A_LAWFUL + 2) - 1)
// (objnam.c:3702) and whatever maketrap() / make_grave() draw.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { newsym } from './display.js';
import { maketrap, Can_fall_thru } from './trap.js';
import { make_grave } from './engrave.js';
import { recalc_block_point } from './vision.js';
import {
    NO_TRAP, TRAPNUM, ROCKTRAP, MAGIC_PORTAL, HOLE, TRAPDOOR,
    FOUNTAIN, THRONE, SINK, POOL, MOAT, WATER, LAVAPOOL, LAVAWALL, ICE, ALTAR,
    GRAVE, TREE, IRONBARS, CLOUD, DOOR, SDOOR, CORR, SCORR, ROOM, VWALL, HWALL,
    DRAWBRIDGE_UP, DRAWBRIDGE_DOWN, DBWALL, STAIRS, LADDER,
    D_NODOOR, D_BROKEN, D_ISOPEN, D_CLOSED, D_LOCKED, D_TRAPPED,
    F_LOOTED, T_LOOTED, S_LPUDDING, S_LDWASHER, S_LRING,
    TREE_LOOTED, TREE_SWARM, ICED_POOL, ICED_MOAT,
    W_NONDIGGABLE, W_NONPASSWALL, WM_MASK,
    A_NONE, A_CHAOTIC, A_NEUTRAL, A_LAWFUL, Align2amask,
    IS_WALL, IS_DOOR, IS_FURNITURE, IS_FOUNTAIN, IS_SINK, IS_GRAVE, IS_POOL,
    IS_LAVA, COLNO, ROWNO,
    // rm.h:291-295. This file used to declare its own copies and every one of
    // the five was wrong (DB_UNDER 0x0f, DB_FLOOR 0, DB_MOAT 2, DB_LAVA 3,
    // DB_ICE 4 vs C's 28/16/0/4/8), so the four drawbridgemask writes below
    // produced masks that js/dbridge.js is_moat()/is_lava()/is_ice() — which
    // use these, the correct, values — then misread.
    DB_UNDER, DB_FLOOR, DB_MOAT, DB_LAVA, DB_ICE,
} from './const.js';
import { isok } from './hacklib.js';

// C ref: drawing.c defsyms[].explanation for S_arrow_trap..S_trapped_chest,
// which is exactly what trap.c:7154 trapname(ttyp, TRUE) returns.  Indexed by
// ttyp (ARROW_TRAP == 1 .. TRAPPED_CHEST == 25); the wish parser walks this in
// ttyp order, so the ORDER of the table is load-bearing, not just its contents.
const TRAP_EXPLANATIONS = [
    null, 'arrow trap', 'dart trap', 'falling rock trap', 'squeaky board',
    'bear trap', 'land mine', 'rolling boulder trap', 'sleeping gas trap',
    'rust trap', 'fire trap', 'pit', 'spiked pit', 'hole', 'trap door',
    'teleportation trap', 'level teleporter', 'magic portal', 'web',
    'statue trap', 'magic trap', 'anti magic trap', 'polymorph trap',
    'vibrating square', 'trapped door', 'trapped chest',
];

// C ref: align.c align_str(alignment).
function align_str(al) {
    switch (al) {
    case A_CHAOTIC: return 'chaotic';
    case A_NEUTRAL: return 'neutral';
    case A_LAWFUL: return 'lawful';
    case A_NONE: return 'unaligned';
    default: return 'unknown';
    }
}

function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
function An(s) { return upstart(an(s)); }
// C ref: hacklib.c upstart().
function upstart(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// C ref: hacklib.c BSTRCMPI(base, ptr, str) used as `!BSTRCMPI(bp, p - N, w)`
// with N == strlen(w): the tail of bp, case-blind, must equal w.
function sfx(bp, w) {
    return bp.length >= w.length && bp.slice(bp.length - w.length).toLowerCase() === w;
}
// C ref: hacklib.c str_start_is(str, chkstr, TRUE) — chkstr is a case-blind
// prefix of str (or vice versa; the shorter one running out means TRUE).
function str_start_is(str, chkstr) {
    const a = str.toLowerCase(), b = chkstr.toLowerCase();
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
    return a.length >= b.length; /* str ran out first => only equal lengths match */
}
// C ref: hacklib.c strncmpi(a, b, n) == 0 — case-blind prefix test.
function pfx(bp, w) { return bp.slice(0, w.length).toLowerCase() === w; }

// C ref: trap.h is_hole(ttyp) / dungeon.c Can_fall_thru(&u.uz).
function is_hole(ttyp) { return ttyp === HOLE || ttyp === TRAPDOOR; }

// C ref: objnam.c:3539 set_wallprop_from_str(bp).  |= because wall_info (aka
// 'flags') is overloaded with other terrain state.
function set_wallprop_from_str(bp, lev) {
    let wall_prop = 0;
    if (bp.includes('undiggable ') || bp.includes('nondiggable ')) wall_prop |= W_NONDIGGABLE;
    if (bp.includes('unphaseable ') || bp.includes('nonpasswall ')) wall_prop |= W_NONPASSWALL;
    if (wall_prop) lev.wall_info = (lev.wall_info | 0) | wall_prop;
}

// C ref: objnam.c:3919 dbterrainmesg(newtype, x, y).
function dbterrainmesg(out, newtype, lev) {
    out.push(`${newtype} ${lev.typ === DRAWBRIDGE_UP ? 'in front of' : 'under'} the drawbridge.`);
}

// C ref: engrave.c:461 del_engr_at(x, y).  js/dbridge.js:850 and js/dokick.js:180
// keep the same one-liner; the engraving list is the only state it touches.
function del_engr_at(x, y) {
    if (!game.level?.engravings) return;
    game.level.engravings = game.level.engravings.filter(
        (ep) => ep.engr_x !== x || ep.engr_y !== y,
    );
}

function lvlflags() {
    const lvl = game.level;
    if (!lvl.flags) lvl.flags = {};
    return lvl.flags;
}

// C ref: mklev.c count_level_features() — recount fountains and sinks after a
// terrain replacement adds or removes one.
function count_level_features() {
    const lvl = game.level;
    if (!lvl) return;
    let nfountains = 0, nsinks = 0;
    for (let x = 0; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const t = lvl.at(x, y)?.typ;
            if (t === FOUNTAIN) nfountains++;
            else if (t === SINK) nsinks++;
        }
    lvl.flags = lvl.flags || {};
    lvl.flags.nfountains = nfountains;
    lvl.flags.nsinks = nsinks;
}

// C ref: pager.c:561 waterbody_name(x, y) with EHalluc_resistance forced on, so
// the hallucinatory liquid names never apply here.
function waterbody_name_sober(lev) {
    switch (lev.typ) {
    case LAVAPOOL: return 'molten lava';
    case ICE: return 'ice';
    case POOL: return 'pool of water';
    case MOAT: return 'moat';
    case WATER: return 'wall of water';
    case LAVAWALL: return 'wall of lava';
    default: return 'pool of water';
    }
}

// C ref: rm.h CAN_OVERWRITE_TERRAIN(ttyp) — stairs and ladders are protected
// unless iflags.debug_overwrite_stairs.  STAIRS/LADDER are the two furniture
// types this port never lets a wish clobber.
function CAN_OVERWRITE_TERRAIN(ttyp) {
    return !!game.iflags?.debug_overwrite_stairs || !(ttyp === LADDER || ttyp === STAIRS);
}

/*
 * C ref: objnam.c:3554 wizterrainwish(d).  Returns TRUE where C returns
 * &hands_obj (a trap or terrain was made, or the request was rejected with a
 * message) and FALSE where C returns NULL (nothing here matched, keep parsing).
 * Messages are appended to `out` instead of being pline()d directly.
 */
export function wizterrainwish(d, out) {
    const u = game.u;
    const x = u.ux, y = u.uy;
    const bp = d.bp || '';
    let madeterrain = false, badterrain = false;

    for (let trap = NO_TRAP + 1; trap < TRAPNUM; trap++) {
        let tname = TRAP_EXPLANATIONS[trap];
        if (!tname || !str_start_is(bp, tname)) continue;
        /* found it; avoid stupid mistakes */
        let ttyp = trap;
        if (is_hole(ttyp) && !Can_fall_thru(u.uz)) ttyp = ROCKTRAP;
        const t = maketrap(x, y, ttyp);
        if (t) {
            ttyp = t.ttyp;
            tname = TRAP_EXPLANATIONS[ttyp] || tname;
            out.push(`${An(tname)}${ttyp !== MAGIC_PORTAL ? '' : ' to nowhere'}.`);
        } else {
            out.push(`Creation of ${an(tname)} failed.`);
        }
        return true;
    }

    /* furniture and terrain (use at your own risk; can clobber stairs
       or place furniture on existing traps which shouldn't be allowed) */
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    const oldtyp = lev.typ;
    const is_dbridge = (oldtyp === DRAWBRIDGE_DOWN || oldtyp === DRAWBRIDGE_UP);

    if (sfx(bp, 'fountain')) {
        lev.typ = FOUNTAIN;
        if (oldtyp !== FOUNTAIN) lvlflags().nfountains = (lvlflags().nfountains | 0) + 1;
        lev.looted = d.looted ? F_LOOTED : 0;
        lev.blessedftn = (d.blessed || pfx(bp, 'magic ')) ? 1 : 0;
        out.push(`A ${lev.blessedftn ? 'magic ' : ''}fountain.`);
        madeterrain = true;
    } else if (sfx(bp, 'throne')) {
        lev.typ = THRONE;
        lev.looted = d.looted ? T_LOOTED : 0;
        out.push('A throne.');
        madeterrain = true;
    } else if (sfx(bp, 'sink')) {
        lev.typ = SINK;
        if (oldtyp !== SINK) lvlflags().nsinks = (lvlflags().nsinks | 0) + 1;
        lev.looted = d.looted ? (S_LPUDDING | S_LDWASHER | S_LRING) : 0;
        out.push('A sink.');
        madeterrain = true;

    /* ("water" matches "potion of water" rather than terrain) */
    } else if (sfx(bp, 'pool') || sfx(bp, 'moat') || sfx(bp, 'wall of water')) {
        const ltyp = sfx(bp, 'pool') ? POOL : sfx(bp, 'moat') ? MOAT : WATER;
        if (!is_dbridge) {
            lev.typ = ltyp;
            lev.flags = 0;
        } else {
            lev.drawbridgemask = ((lev.drawbridgemask | 0) & ~DB_UNDER) | DB_MOAT;
        }
        del_engr_at(x, y);
        if (!is_dbridge) out.push(`${An(waterbody_name_sober(lev))}.`);
        else dbterrainmesg(out, 'Moat', lev);
        // GAP: C water_damage_chain(level.objects[x][y], TRUE) rusts/soaks the
        // floor pile here; js/trap.js has no chain-wide water_damage.
        madeterrain = true;

    /* also matches "molten lava" */
    } else if (sfx(bp, 'lava') || sfx(bp, 'wall of lava')) {
        const ltyp = sfx(bp, 'wall of lava') ? LAVAWALL : LAVAPOOL;
        if (!is_dbridge) {
            lev.typ = ltyp;
            lev.flags = 0;
        } else {
            lev.drawbridgemask = ((lev.drawbridgemask | 0) & ~DB_UNDER) | DB_LAVA;
        }
        del_engr_at(x, y);
        if (!is_dbridge) {
            out.push(`A ${lev.typ === LAVAPOOL ? 'pool' : 'wall'} of molten lava.`);
            // GAP: pooleffects(FALSE) — burning/drowning the hero who wished the
            // ground out from under themself is a whole death path (trap.c).
        } else {
            dbterrainmesg(out, 'Lava', lev);
        }
        // GAP: fire_damage_chain() on the floor pile.
        madeterrain = true;
    } else if (sfx(bp, 'ice')) {
        if (!is_dbridge) {
            lev.typ = ICE;
            lev.icedpool = (oldtyp === ROOM) ? ICED_POOL : ICED_MOAT;
        } else {
            lev.drawbridgemask = ((lev.drawbridgemask | 0) & ~DB_UNDER) | DB_ICE;
        }
        del_engr_at(x, y);
        // GAP: "melting ice" starts a MELT_ICE_AWAY timeout (no timer subsystem).
        if (!is_dbridge) out.push(`${upstart(ice_descr(lev))}.`);
        else dbterrainmesg(out, 'Ice', lev);
        madeterrain = true;
    } else if (sfx(bp, 'altar')) {
        let al;
        lev.typ = ALTAR;
        if (pfx(bp, 'chaotic ')) al = A_CHAOTIC;
        else if (pfx(bp, 'neutral ')) al = A_NEUTRAL;
        else if (pfx(bp, 'lawful ')) al = A_LAWFUL;
        else if (pfx(bp, 'unaligned ')) al = A_NONE;
        else /* -1 - A_CHAOTIC, 0 - A_NEUTRAL, 1 - A_LAWFUL */
            al = !rn2(6) ? A_NONE : (rn2(A_LAWFUL + 2) - 1);
        // rm.h aliases altarmask to 'flags'; this port keeps both names in sync
        // (js/mklev.js:3576 does the same) because readers use either one.
        lev.altarmask = Align2amask(al);
        lev.flags = lev.altarmask;
        out.push(`${An(align_str(al))} altar.`);
        madeterrain = true;
    } else if (sfx(bp, 'grave') || sfx(bp, 'headstone')) {
        make_grave(x, y, null);
        if (IS_GRAVE(lev.typ)) {
            lev.looted = 0;
            lev.disturbed = d.looted ? 1 : 0;
            out.push(`A ${lev.disturbed ? 'disturbed ' : ''}grave.`);
            madeterrain = true;
        } else {
            out.push("Can't place a grave here.");
            badterrain = true;
        }
    } else if (sfx(bp, 'tree')) {
        lev.typ = TREE;
        lev.looted = d.looted ? (TREE_LOOTED | TREE_SWARM) : 0;
        set_wallprop_from_str(bp, lev);
        out.push('A tree.');
        madeterrain = true;
    } else if (sfx(bp, 'bars')) {
        lev.typ = IRONBARS;
        lev.flags = 0;
        set_wallprop_from_str(bp, lev);
        out.push('Iron bars.');
        madeterrain = true;
    } else if (sfx(bp, 'cloud')) {
        lev.typ = CLOUD;
        lev.flags = 0;
        out.push('A cloud.');
        del_engr_at(x, y);
        madeterrain = true;
    } else if (sfx(bp, 'door') || (d.doorless && sfx(bp, 'doorway'))) {
        const secret = sfx(bp, 'secret door');
        /* require door or wall so that the 'horizontal' flag will already have
           the correct value; iron bars are surrogate walls */
        if (lev.typ === DOOR || lev.typ === SDOOR
            || (IS_WALL(lev.typ) && lev.typ !== DBWALL)
            || lev.typ === IRONBARS) {
            const old_wall_info = (lev.typ !== DOOR) ? (lev.wall_info | 0) : 0;
            lev.typ = secret ? SDOOR : DOOR;
            lev.wall_info = 0;
            lev.doormask = d.locked ? D_LOCKED
                : (d.doorless || secret) ? D_NODOOR
                    : d.open ? D_ISOPEN
                        : d.broken ? D_BROKEN
                            : D_CLOSED;
            if (secret) lev.wall_info |= (old_wall_info & WM_MASK);
            let trapped = d.trapped;
            if (trapped === 2 /* explicit "untrapped" */
                || ((lev.doormask & (D_LOCKED | D_CLOSED)) === 0 && !secret))
                trapped = 0;
            if (trapped) lev.doormask |= D_TRAPPED;
            let dbuf = '';
            if (lev.doormask & D_TRAPPED) dbuf += 'trapped ';
            if (lev.doormask & D_LOCKED) dbuf += 'locked ';
            if (lev.typ === SDOOR) {
                dbuf += 'secret door';
            } else {
                if (lev.doormask & D_CLOSED) dbuf += 'closed ';
                if (lev.doormask & D_ISOPEN) dbuf += 'open ';
                if (lev.doormask & D_BROKEN) dbuf += 'broken ';
                if ((lev.doormask & ~D_TRAPPED) === D_NODOOR) dbuf += 'doorless doorway';
                else dbuf += 'door';
            }
            out.push(`${upstart(an(dbuf))}.`);
            madeterrain = true;
        } else {
            out.push(`${upstart(secret ? 'secret door' : 'door')} requires door or wall location.`);
            badterrain = true;
        }
    } else if (sfx(bp, 'wall')
               && (bp.length === 4 || bp[bp.length - 5] === ' ')) {
        let wall = HWALL;
        if ((isok(x, y - 1) && IS_WALL(game.level.at(x, y - 1)?.typ))
            || (isok(x, y + 1) && IS_WALL(game.level.at(x, y + 1)?.typ)))
            wall = VWALL;
        madeterrain = true;
        lev.typ = wall;
        lev.flags = 0;
        set_wallprop_from_str(bp, lev);
        // GAP: fix_wall_spines() re-derives the neighbours' wall modes.
        out.push('A wall.');
    } else if (sfx(bp, 'secret corridor')) {
        if (lev.typ === CORR) {
            lev.typ = SCORR;
            out.push('Secret corridor.');
            madeterrain = true;
        } else {
            out.push('Secret corridor requires corridor location.');
            badterrain = true;
        }
    } else if (sfx(bp, 'room') || sfx(bp, 'floor') || sfx(bp, 'ground')) {
        if (oldtyp === ROOM
            || (IS_FURNITURE(oldtyp) && CAN_OVERWRITE_TERRAIN(oldtyp))
            || oldtyp === ICE || IS_POOL(oldtyp) || IS_LAVA(oldtyp)) {
            lev.typ = ROOM;
            out.push('Room floor.');
            if (IS_FURNITURE(oldtyp)) count_level_features();
            const traps = game.level?.traps;
            if (Array.isArray(traps)) {
                const ti = traps.findIndex((t) => t && t.tx === x && t.ty === y);
                if (ti >= 0 && traps[ti].ttyp !== MAGIC_PORTAL) traps.splice(ti, 1);
            }
            madeterrain = true;
        } else if (is_dbridge) {
            lev.drawbridgemask = ((lev.drawbridgemask | 0) & ~DB_UNDER) | DB_FLOOR;
            dbterrainmesg(out, 'Floor', lev);
            madeterrain = true;
        } else {
            out.push('Room|floor|ground not allowed here.');
            badterrain = true;
        }
    }

    if (madeterrain) {
        newsym(x, y); /* C: feel_newsym(x, y) — map the spot */
        recalc_block_point(x, y);

        /* fixups for replaced terrain that aren't handled above */
        if (IS_FOUNTAIN(oldtyp) || IS_SINK(oldtyp)) count_level_features();
        if (IS_FOUNTAIN(oldtyp) || IS_GRAVE(oldtyp) || IS_WALL(oldtyp)
            || oldtyp === IRONBARS || IS_DOOR(oldtyp) || oldtyp === SDOOR) {
            if (!IS_FOUNTAIN(lev.typ) && !IS_GRAVE(lev.typ)
                && !IS_DOOR(lev.typ) && lev.typ !== SDOOR)
                lev.horizontal = false; /* also clears blessedftn, disturbed */
        }
        // GAP: switch_terrain() — levitation/flying re-evaluation for a hero who
        // replaced the solid stone they were phasing through.
    }
    return madeterrain || badterrain;
}

// C ref: pager.c:614 ice_descr(x, y, outbuf) — the far/blind arm returns
// waterbody_name(); close up it prefixes a thickness word derived from the
// MELT_ICE_AWAY timeout.  Freshly-wished ice has no timer, so C's `!time_left`
// arm ("solid ice") is what this reaches.
function ice_descr(lev) {
    return lev.typ === ICE ? 'solid ice' : waterbody_name_sober(lev);
}
