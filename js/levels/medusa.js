// levels/medusa.js - special level builders makemaz_medusa1..4 (dat/medusa-N.lua).
// sp_lev.js re-exports them; the shared special-level machinery stays there.
//
// mkmaze.c:1136 picks the variant with rnd(sp->rndlevs) (rndlevs == 4), so all
// four scripts must exist or the roll lands on an unported one.
//
// Two things here live nowhere else in the port:
//   * sp_lev.c create_object()'s Is_medusa_level() block — a des.object statue
//     with no montype becomes a petrified REAL monster: a full makemon at a
//     random spot (position search, HP, gender, starting inventory), retried
//     until the species is not stoning-resistant, then its pack is emptied into
//     the statue.  That is where most of this level's PRNG goes.
//   * dungeon.lua gives the medusa s_level `alignment = "chaotic"`, so
//     induced_align(80) draws rn2(100) FIRST and only falls through to the
//     usual rn2(3) when that fails.  Every other ported special level inherits
//     an unaligned dungeon, which is why the shared splev_create_monster() gets
//     away with a bare rn2(3).

import {
    ACCESSIBLE, COLNO, CORR, DOOR, D_CLOSED, D_LOCKED, FOUNTAIN, IS_FURNITURE, IS_LAVA, IS_POOL,
    LADDER, LA_DOWN, LA_UP, MAGIC_TRAP,
    MM_NOCOUNTBIRTH, MM_NOMSG, NO_TRAP, OROOM, ROCKTRAP, ROOM, ROWNO, RUST_TRAP, SQKY_BOARD,
    STAIRS, TRAPNUM, is_hole, isok,
} from '../const.js';
import { Is_special } from '../dungeon.js';
import { game } from '../gstate.js';
import { depth as depth_of_level } from '../hacklib.js';
import {
    MGEND_NEUTRAL, enexto_spawn, makemon, mkclass, mm_mon_at, monster_by_pmidx,
    name_gender_hint, name_to_pmidx, propagate, rndmonst,
} from '../makemon.js';
import { resists_ston } from '../mon.js';
import {
    BOULDER, CRYSTAL_BALL, EGG, LEVITATION_BOOTS, SACK, SCR_BLANK_PAPER, STATUE, WAND_CLASS,
    add_to_container, mk_tt_object, mkobj_at, mksobj_at, set_corpsenm, weight,
} from '../mkobj.js';
import { somex, somey } from '../mkroom.js';
import { rn1, rn2, rnd } from '../rng.js';
import {
    LOC_DRY, bigrm_get_level_extends, bigrm_load_map, bigrm_wallification, flip_level, percent,
    pm_to_humidity, quest_level_init_solidfill, quest_place_stair, quest_rndcoord, quest_set_door,
    remove_boundary_syms, shuffle, splev_door_at, splev_feature, splev_get_location_rnd,
    splev_link_doors_rooms, splev_region_lit, splev_traptype_rnd, vly_abs, vly_non_diggable,
    vly_region, vly_teleport_region,
} from '../sp_lev.js';
import { Can_fall_thru, maketrap, t_at } from '../trap.js';

// C ref: obj.h — a statue's spe carries the CORPSTAT_* bits lspo_object builds
// from the historic/male/female table keys before create_object() writes it.
const CORPSTAT_MALE = 1, CORPSTAT_HISTORIC = 4;
// C ref: objects[] indices (mkobj.js exports no constant for these two).
const SCIMITAR = 50, SHIELD_OF_REFLECTION = 158;
// C ref: mklev.h — create_trap() always passes both of these.
const MKTRAP_MAZEFLAG = 0x01, MKTRAP_NOSPIDERONWEB = 0x04;
// C ref: dungeon.h lev_region rtypes, in lspo_levregion's regiontypes2i order.
const LR_DOWNSTAIR = 0, LR_UPSTAIR = 1, LR_BRANCH = 3;
// C ref: monsym.h def_char_to_monclass — the class chars these scripts use.
const S_ANGEL = 1, S_SNAKE = 45;
// C ref: monst.h MR_STONE, the bit resists_ston() reads off the species.
const MR_STONE = 0x80;

const MEDUSA1_MAP = [
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}.}}}}}..}}}}}......}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}....}}}...}}}}}',
    '}...}}.....}}}}}....}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}...............}',
    '}....}}}}}}}}}}....}}}..}}}}}}}}}}}.......}}}}}}}}}}}}}}}}..}}.....}}}...}}',
    '}....}}}}}}}}.....}}}}..}}}}}}.................}}}}}}}}}}}.}}}}.....}}...}}',
    '}....}}}}}}}}}}}}.}}}}.}}}}}}.-----------------.}}}}}}}}}}}}}}}}}.........}',
    '}....}}}}}}}}}}}}}}}}}}.}}}...|...............S...}}}}}}}}}}}}}}}}}}}....}}',
    '}.....}.}}....}}}}}}}}}.}}....--------+--------....}}}}}}..}}}}}}}}}}}...}}',
    '}......}}}}..}}}}}}}}}}}}}........|.......|........}}}}}....}}}}}}}}}}}}}}}',
    '}.....}}}}}}}}}}}}}}}}}}}}........|.......|........}}}}}...}}}}}}}}}.}}}}}}',
    '}.....}}}}}}}}}}}}}}}}}}}}....--------+--------....}}}}}}.}.}}}}}}}}}}}}}}}',
    '}......}}}}}}}}}}}}}}}}}}}}...S...............|...}}}}}}}}}}}}}}}}}.}}}}}}}',
    '}.......}}}}}}}..}}}}}}}}}}}}.-----------------.}}}}}}}}}}}}}}}}}....}}}}}}',
    '}........}}.}}....}}}}}}}}}}}}.................}}}}}..}}}}}}}}}.......}}}}}',
    '}.......}}}}}}}......}}}}}}}}}}}}}}.......}}}}}}}}}.....}}}}}}...}}..}}}}}}',
    '}.....}}}}}}}}}}}.....}}}}}}}}}}}}}}}}}}}}}}.}}}}}}}..}}}}}}}}}}....}}}}}}}',
    '}}..}}}}}}}}}}}}}....}}}}}}}}}}}}}}}}}}}}}}...}}..}}}}}}}.}}.}}}}..}}}}}}}}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
].join('\n');

const MEDUSA2_MAP = [
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}------}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}-------}}}}}}}}--------------}',
    '}|....|}}}}}}}}}..}.}}..}}}}}}}}}}}}}..}}}}}}-.....--}}}}}}}|............|}',
    '}|....|.}}}}}}}}}}}.}...}}..}}}}}}}}}}}}}}}}}---......}}}}}.|............|}',
    '}S....|.}}}}}}---}}}}}}}}}}}}}}}}}}}}}}}}}}---...|..-}}}}}}.S..----------|}',
    '}|....|.}}}}}}-...}}}}}}}}}.}}...}.}}}}.}}}......----}}}}}}.|............|}',
    '}|....|.}}}}}}-....--}}}}}}}}}}}}}}}}}}}}}}----...--}}}}}}}.|..--------+-|}',
    '}|....|.}}}}}}}......}}}}...}}}}}}.}}}}}}}}}}}---..---}}}}}.|..|..S...|..|}',
    '}|....|.}}}}}}-....-}}}}}}}------}}}}}}}}}}}}}}-...|.-}}}}}.|..|..|...|..|}',
    '}|....|.}}}}}}}}}---}}}}}}}........}}}}}}}}}}---.|....}}}}}.|..|..|...|..|}',
    '}|....|.}}}}}}}}}}}}}}}}}}-....|...-}}}}}}}}--...----.}}}}}.|..|..|...|..|}',
    '}|....|.}}}}}}..}}}}}}}}}}---..--------}}}}}-..---}}}}}}}}}.|..|..-------|}',
    '}|...}|...}}}.}}}}}}...}}}}}--..........}}}}..--}}}}}}}}}}}.|..|.........|}',
    '}|...}S...}}.}}}}}}}}}}}}}}}-..--------}}}}}}}}}}}}}}...}}}.|..--------..S}',
    '}|...}|...}}}}}}}..}}}}}}----..|....-}}}}}}}}}}}}}}}}}..}}}.|............|}',
    '}|....|}}}}}....}}}}..}}.-.......----}}......}}}}}}.......}}|............|}',
    '}------}}}}}}}}}}}}}}}}}}---------}}}}}}}}}}}}}}}}}}}}}}}}}}--------------}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
].join('\n');

const MEDUSA3_MAP = [
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}}}}}}}}}.}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}.}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}}}}}}}T..T.}}}}}}}}}}}}}}}}}}}}..}}}}}}}}.}}}...}}}}}}}.}}}}}......}}}}}}}',
    '}}}}}}.......T.}}}}}}}}}}}..}}}}..T.}}}}}}...T...T..}}...T..}}..-----..}}}}}',
    '}}}...-----....}}}}}}}}}}.T..}}}}}...}}}}}.....T..}}}}}......T..|...|.T..}}}',
    '}}}.T.|...|...T.}}}}}}}.T......}}}}..T..}}.}}}.}}...}}}}}.T.....+...|...}}}}',
    '}}}}..|...|.}}.}}}}}.....}}}T.}}}}.....}}}}}}.T}}}}}}}}}}}}}..T.|...|.}}}}}}',
    '}}}}}.|...|.}}}}}}..T..}}}}}}}}}}}}}T.}}}}}}}}..}}}}}}}}}}}.....-----.}}}}}}',
    '}}}}}.--+--..}}}}}}...}}}}}}}}}}}}}}}}}}}T.}}}}}}}}}}}}}}}}.T.}........}}}}}',
    '}}}}}.......}}}}}}..}}}}}}}}}.}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}.}}}.}}.T.}}}}}}',
    '}}.T...T...}}}}T}}}}}}}}}}}....}}}}}}}}}}T}}}}}.T}}...}}}}}}}}}}}}}}...}}}}}',
    '}}}...T}}}}}}}..}}}}}}}}}}}.T...}}}}}}}}.T.}.T.....T....}}}}}}}}}}}}}.}}}}}}',
    '}}}}}}}}}}}}}}}....}}}}}}}...}}.}}}}}}}}}}............T..}}}}}.T.}}}}}}}}}}}',
    '}}}}}}}}}}}}}}}}..T..}}}}}}}}}}}}}}..}}}}}..------+--...T.}}}....}}}}}}}}}}}',
    '}}}}.}..}}}}}}}.T.....}}}}}}}}}}}..T.}}}}.T.|...|...|....}}}}}.}}}}}...}}}}}',
    '}}}.T.}...}..}}}}T.T.}}}}}}.}}}}}}}....}}...|...+...|.}}}}}}}}}}}}}..T...}}}',
    '}}}}..}}}.....}}...}}}}}}}...}}}}}}}}}}}}}T.|...|...|}}}}}}}}}}}....T..}}}}}',
    '}}}}}..}}}.T..}}}.}}}}}}}}.T..}}}}}}}}}}}}}}---S-----}}}}}}}}}}}}}....}}}}}}',
    '}}}}}}}}}}}..}}}}}}}}}}}}}}}.}}}}}}}}}}}}}}}}}T..T}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
].join('\n');

const MEDUSA4_MAP = [
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}}}}}}}}}}}}}........}}}}}}}}}}}}}}}}}}}}}}}..}}}.....}}}}}}}}}}}----|}}}}}',
    '}}}}}}..----------F-.....}}}}}}}}}}}}}}}}..---...}}}}....T.}}}}}}}....|}}}}}',
    '}}}.....|...F......S}}}}....}}}}}}}...}}.....|}}.}}}}}}}......}}}}|......}}}',
    '}}}.....+...|..{...|}}}}}}}}}}}}.....}}}}|...|}}}}}}}}}}}.}}}}}}}}----.}}}}}',
    '}}......|...|......|}}}}}}}}}......}}}}}}|.......}}}}}}}}}}}}}..}}}}}...}}}}',
    '}}|-+--F|-+--....|F|-|}}}}}....}}}....}}}-----}}.....}}}}}}}......}}}}.}}}}}',
    '}}|...}}|...|....|}}}|}}}}}}}..}}}}}}}}}}}}}}}}}}}}....}}}}}}}}....T.}}}}}}}',
    '}}|...}}F...+....F}}}}}}}..}}}}}}}}}}}}}}...}}}}}}}}}}}}}}}}}}}}}}....}}..}}',
    '}}|...}}|...|....|}}}|}....}}}}}}....}}}...}}}}}...}}}}}}}}}}}}}}}}}.....}}}',
    '}}--+--F|-+--....-F|-|....}}}}}}}}}}.T...}}}}....---}}}}}}}}}}}}}}}}}}}}}}}}',
    '}}......|...|......|}}}}}.}}}}}}}}}....}}}}}}}.....|}}}}}}}}}.}}}}}}}}}}}}}}',
    '}}}}....+...|..{...|.}}}}}}}}}}}}}}}}}}}}}}}}}}.|..|}}}}}}}......}}}}...}}}}',
    '}}}}}}..|...F......|...}}}}}}}}}}..---}}}}}}}}}}--.-}}}}}....}}}}}}....}}}}}',
    '}}}}}}}}-----S----F|....}}}}}}}}}|...|}}}}}}}}}}}}...}}}}}}...}}}}}}..}}}}}}',
    '}}}}}}}}}..............T...}}}}}.|.......}}}}}}}}}}}}}}..}...}.}}}}....}}}}}',
    '}}}}}}}}}}....}}}}...}...}}}}}.......|.}}}}}}}}}}}}}}.......}}}}}}}}}...}}}}',
    '}}}}}}}}}}..}}}}}}}}}}.}}}}}}}}}}-..--.}}}}}}}}..}}}}}}..T...}}}..}}}}}}}}}}',
    '}}}}}}}}}...}}}}}}}}}}}}}}}}}}}}}}}...}}}}}}}....}}}}}}}.}}}..}}}...}}}}}}}}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}.}}}}}}....}}}}}}}}}}}}}}}}}}}...}}}}}}',
    '}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}',
].join('\n');

// ── shared machinery ────────────────────────────────────────────────────

// C ref: mkmap.c litstate_rnd() — `lit < 0` is BOOL_RANDOM; the && short-
// circuits rn2(77) away whenever the depth roll already failed.
function med_litstate_rnd(litstate) {
    if (litstate < 0) {
        const d = depth_of_level(game.u?.uz);
        return (rnd(1 + Math.abs(d)) < 11 && rn2(77)) ? 1 : 0;
    }
    return litstate ? 1 : 0;
}

// C ref: dungeon.c induced_align(pct).  dungeon.lua gives the medusa s_level
// `alignment = "chaotic"`, so the FIRST test is live here and an 80% roll ends
// the function before the usual rn2(3) is ever reached.
function med_induced_align(pct) {
    const uz = game.u?.uz;
    const lev = Is_special(uz);
    if (lev?.flags?.align && rn2(100) < pct) return lev.flags.align;
    const dgn = game.dungeons?.[uz?.dnum ?? 0];
    if (dgn?.flags?.align && rn2(100) < pct) return dgn.flags.align;
    return rn2(3);                                 // Align2amask(rn2(3) - 1)
}

// C ref: makemon.c rndmonnum().
function med_rndmonnum() { return rndmonst()?.pmidx ?? 0; }

// C ref: sp_lev.c create_monster(), with lspo_monster's find_montype gender
// roll folded in (that happens during the parse, so it precedes induced_align).
function med_monster({ name = null, cls = 0, mx = null, my = null,
                       peaceful = null, asleep = null }) {
    let ptr = null;
    if (name != null) {
        const pmidx = name_to_pmidx(name);
        ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
        // A species whose only pmname is gendered ("wood nymph", "Medusa")
        // makes find_montype report that gender, and then nothing is rolled.
        if (ptr && ptr.gcode !== 1 && ptr.gcode !== 2
            && name_gender_hint(name) === MGEND_NEUTRAL)
            rn2(2);
    }
    med_induced_align(80);
    if (name == null && cls) ptr = mkclass(cls, 0x0200 /* G_NOGEN */);
    let x, y;
    if (mx != null) { const c = vly_abs(mx, my); x = c.x; y = c.y; }
    else if (ptr) {
        const hum = pm_to_humidity(ptr);
        let r = splev_get_location_rnd(hum, true);
        if (r.x === -1 && r.y === -1) r = splev_get_location_rnd(hum | LOC_DRY);
        x = r.x; y = r.y;
    } else {
        const r = splev_get_location_rnd(LOC_DRY);
        x = r.x; y = r.y;
    }
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    const mtmp = makemon(ptr, x, y, 0 /* NO_MM_FLAGS */);
    if (mtmp && peaceful != null) mtmp.mpeaceful = peaceful ? 1 : 0;
    if (mtmp && asleep != null) mtmp.msleeping = asleep ? 1 : 0;
    return mtmp;
}

// C ref: mon.c mongone() — the monster leaves without dying and without a
// corpse.  Its pack has already been emptied into the statue by the caller.
function med_mongone(mtmp) {
    const lvl = game.level;
    if (lvl?.monsters) {
        const i = lvl.monsters.indexOf(mtmp);
        if (i >= 0) lvl.monsters.splice(i, 1);
    }
}

// C ref: mondata.c:80 poly_when_stoned(ptr) — a golem other than the stone
// golem turns to stone instead of dying, so it cannot be a Medusa statue.
// C's third term (!mvitals[PM_STONE_GOLEM].mvflags & G_GENOD) needs a
// genocide, which no covered session performs.
const MED_S_GOLEM = 55;                            // defsym.h MONSYM(55, '\'')
function med_poly_when_stoned(ptr) {
    return !!ptr && ptr.mcls === MED_S_GOLEM && ptr.name !== 'stone golem';
}

// C ref: sp_lev.c create_object()'s `Is_medusa_level(&u.uz)` block.  Statues
// here are petrified monsters: generate the real monster (a full makemon at a
// random spot), reject stone-resistant species, then move its inventory into
// the statue and remove it.
function med_statue_petrify(otmp) {
    let was = null, wastyp = otmp.corpsenm ?? 0;
    for (let i = 0; i < 1000; i++, wastyp = med_rndmonnum()) {
        const ptr = monster_by_pmidx(wastyp);
        was = makemon(ptr, 0, 0, MM_NOCOUNTBIRTH | MM_NOMSG);
        if (was) {
            if (!resists_ston(was) && !med_poly_when_stoned(ptr)) {
                propagate(wastyp, true, false);    // makemon was told not to
                break;
            }
            med_mongone(was);
            was = null;
        }
    }
    if (!was) return;
    set_corpsenm(otmp, wastyp);
    const inv = was.minvent || [];
    while (inv.length) {
        const obj = inv.shift();
        obj.owornmask = 0;
        add_to_container(otmp, obj);
    }
    otmp.owt = weight(otmp);
    med_mongone(was);
}

// ── objects ──────────────────────────────────────────────────────────────

// C ref: sp_lev.c create_object().  An `o.name` makes C's `named` TRUE, which
// turns mkobj/mksobj's `artif` argument OFF (a named random object must not
// become an artifact).  Everything after the object exists is straight-line
// except the Medusa statue block at the tail.
//   o = { otyp, oclass, coord:{x,y}|null, buc, spe, montype, name,
//         contents: fn|0|undefined }
function med_object(o) {
    const named = !!o.name;
    let x, y;
    if (o.coord) { const c = vly_abs(o.coord.x, o.coord.y); x = c.x; y = c.y; }
    else { const c = splev_get_location_rnd(LOC_DRY); x = c.x; y = c.y; }
    let otmp;
    if (o.otyp != null) otmp = mksobj_at(o.otyp, x, y, true, !named);
    else if (o.oclass != null) otmp = mkobj_at(o.oclass, x, y, !named);
    else otmp = mkobj_at(0 /* RANDOM_CLASS */, x, y, !named);
    if (!otmp) return null;
    if (o.spe != null) otmp.spe = o.spe;
    switch (o.buc) {
    case 'blessed': otmp.blessed = true; otmp.cursed = false; break;
    case 'uncursed': otmp.blessed = false; otmp.cursed = false; break;
    case 'cursed': otmp.cursed = true; otmp.blessed = false; break;
    default: break;                                // keep what mkobj gave us
    }
    if (o.montype != null) {
        const pmidx = name_to_pmidx(o.montype);
        if (pmidx >= 0) set_corpsenm(otmp, pmidx);
    }
    if (named) otmp.oname = o.name;
    // A `contents` key that is merely PRESENT (even the number 0) sets
    // SP_OBJ_CONTAINER, whose first act is delete_contents() — that is what
    // throws away the spellbook mksobj_init() may have put inside a statue.
    if (o.contents !== undefined) otmp.cobj = [];
    if (o.otyp === STATUE && o.montype == null) med_statue_petrify(otmp);
    if (typeof o.contents === 'function') o.contents(otmp);
    return otmp;
}

// C ref: create_object() for an object inside a `contents` function: the
// container is on the stack, so the object is made at a random DRY spot (that
// is where its RNG goes) and only then moved into the container.
function med_contained(container, spec) {
    const otmp = med_object(spec);
    if (!otmp || !container) return otmp;
    const objs = game.level?.objects;
    if (objs) { const i = objs.indexOf(otmp); if (i >= 0) objs.splice(i, 1); }
    add_to_container(container, otmp);
    container.owt = weight(container);
    return otmp;
}

// C ref: medusa-*.lua — the Perseus statue's contents function.  All four
// percent() gates draw a real rn2(100) whatever they decide; medusa-1/3/4 use
// 75/25 for shield/boots, medusa-2 swaps them to 25/75.
function med_perseus_statue(coord, shieldPct, bootsPct) {
    return med_object({
        otyp: STATUE, coord, buc: 'uncursed', montype: 'knight',
        spe: CORPSTAT_HISTORIC | CORPSTAT_MALE, name: 'Perseus',
        contents: (statue) => {
            if (percent(shieldPct))
                med_contained(statue, { otyp: SHIELD_OF_REFLECTION,
                                        buc: 'cursed', spe: 0 });
            if (percent(bootsPct))
                med_contained(statue, { otyp: LEVITATION_BOOTS, spe: 0 });
            if (percent(50))
                med_contained(statue, { otyp: SCIMITAR, buc: 'blessed', spe: 2 });
            if (percent(50))
                med_contained(statue, { otyp: SACK });
        },
    });
}

// ── traps ────────────────────────────────────────────────────────────────

// C ref: sp_lev.c create_trap() + mklev.c mktrap(), for the des.trap() forms
// these scripts use.  A random location re-rolls while it lands on stairs; the
// trailing rnd(4) is mktrap()'s dead-predecessor check, which is evaluated
// (and at this depth always fails) before the SQKY_BOARD/RUST_TRAP exclusions.
async function med_trap(ttyp, mx = null, my = null) {
    let x, y;
    if (mx != null) {
        const c = vly_abs(mx, my); x = c.x; y = c.y;
    } else {
        let trycnt = 0;
        for (;;) {
            const c = splev_get_location_rnd(LOC_DRY); x = c.x; y = c.y;
            const t = game.level?.at(x, y)?.typ;
            if (t !== STAIRS && t !== LADDER) break;
            if (++trycnt > 100) return;
        }
    }
    const loc = game.level?.at(x, y);
    if (!loc || IS_POOL(loc.typ) || IS_LAVA(loc.typ)) return;
    let kind = ttyp;
    if (!(kind > NO_TRAP && kind < TRAPNUM)) {
        do {
            kind = splev_traptype_rnd(MKTRAP_MAZEFLAG | MKTRAP_NOSPIDERONWEB);
        } while (kind === NO_TRAP);
    }
    if (is_hole(kind) && !Can_fall_thru(game.u?.uz)) kind = ROCKTRAP;
    await maketrap(x, y, kind);
    rnd(4);                                        // mklev.c:2137 victim check
}

// ── level regions (fixup_special) ────────────────────────────────────────

// C ref: mkmaze.c occupied().  invocation_pos() is unreachable off the
// invocation level, so it is not modelled.
function med_occupied(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    return !!(t_at(x, y) || IS_FURNITURE(loc.typ) || IS_LAVA(loc.typ)
              || IS_POOL(loc.typ));
}

// C ref: mkmaze.c bad_location().
function med_bad_location(x, y, r) {
    if (!isok(x, y)) return true;
    if (med_occupied(x, y)) return true;
    if (r.nlx > 0 && x >= r.nlx && x <= r.nhx && y >= r.nly && y <= r.nhy)
        return true;
    const typ = game.level.at(x, y).typ;
    return !((typ === CORR && !!game.level?.flags?.is_maze_lev) || typ === ROOM);
}

// C ref: mklev.c mkstairs() — reached from put_lregion_here()'s LR_*STAIR arm.
// The dungeon-end guard is load-bearing: a level at the top/bottom of its
// dungeon gets no stair even though the levregion asked for one.
function med_mkstairs(x, y, up) {
    const g = game;
    const nlev = g.dungeons?.[g.u?.uz?.dnum ?? 0]?.num_dunlevs ?? 0;
    if ((g.u?.uz?.dlevel ?? 1) === (up ? 1 : nlev)) return;
    const loc = g.level?.at(x, y);
    if (loc) { loc.typ = STAIRS; loc.ladder = up ? LA_UP : LA_DOWN; }
    if (!Array.isArray(g.stairs)) g.stairs = [];
    g.stairs.push({ sx: x, sy: y, up: !!up, isladder: false,
                    tolev: { dnum: g.u?.uz?.dnum ?? 0,
                             dlevel: (g.u?.uz?.dlevel ?? 1) + (up ? -1 : 1) } });
    if (up) { g.upstair = { x, y }; if (g.level) g.level.upstair = { x, y }; }
    else { g.dnstair = { x, y }; if (g.level) g.level.dnstair = { x, y }; }
}

// C ref: mkmaze.c put_lregion_here().  LR_BRANCH lands on place_branch(), which
// returns immediately when Is_branchlev() is NULL — true on every Medusa level,
// so that arm still has to consume the rn1 pairs and then do nothing.
function med_put_lregion_here(x, y, r, oneshot) {
    if (med_bad_location(x, y, r) && !oneshot) return false;
    if (med_bad_location(x, y, r)) return false;
    if (r.rtype === LR_UPSTAIR || r.rtype === LR_DOWNSTAIR)
        med_mkstairs(x, y, r.rtype === LR_UPSTAIR);
    return true;
}

// C ref: mkmaze.c place_lregion().
function med_place_lregion(r) {
    let lx = r.lx, ly = r.ly, hx = r.hx, hy = r.hy;
    if (!lx) { lx = 1; hx = COLNO - 1; ly = 0; hy = ROWNO - 1; }
    if (lx < 1) lx = 1;
    if (hx > COLNO - 1) hx = COLNO - 1;
    if (ly < 0) ly = 0;
    if (hy > ROWNO - 1) hy = ROWNO - 1;
    const oneshot = (lx === hx && ly === hy);
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        const x = rn1((hx - lx) + 1, lx);          // mkmaze.c:396
        const y = rn1((hy - ly) + 1, ly);          // mkmaze.c:397
        if (med_put_lregion_here(x, y, r, oneshot)) return;
    }
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (med_put_lregion_here(x, y, r, true)) return;
}

// des.levregion({region={x1,y1,x2,y2}, exclude={...}, type=...}) — map-relative
// coordinates, resolved by levregion_add()'s get_location(ANY_LOC).  No RNG.
function med_lregion(rtype, x1, y1, x2, y2, ex = null) {
    const a = vly_abs(x1, y1), b = vly_abs(x2, y2);
    const e = ex ? { a: vly_abs(ex[0], ex[1]), b: vly_abs(ex[2], ex[3]) } : null;
    return { rtype, lx: a.x, ly: a.y, hx: b.x, hy: b.y,
             nlx: e ? e.a.x : -1, nly: e ? e.a.y : -1,
             nhx: e ? e.b.x : -1, nhy: e ? e.b.y : -1 };
}

// C ref: sp_lev.c flip_level() also flips gl.lregions[] and the stored
// up/down teleport destinations.
function med_flip_rect(r, kx1, ky1, kx2, ky2, flp) {
    if (!r) return;
    const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
    const inArea = (x, y) => (x >= minx && x <= maxx && y >= miny && y <= maxy);
    for (const [kx, ky] of [[kx1, ky1], [kx2, ky2]]) {
        if (!inArea(r[kx], r[ky])) continue;
        if (flp & 1) r[ky] = miny + maxy - r[ky];
        if (flp & 2) r[kx] = minx + maxx - r[kx];
    }
    if (r[kx1] > r[kx2]) { const t = r[kx1]; r[kx1] = r[kx2]; r[kx2] = t; }
    if (r[ky1] > r[ky2]) { const t = r[ky1]; r[ky1] = r[ky2]; r[ky2] = t; }
}

// C ref: teleport.c goodpos(x, y, NULL, 0) — with a NULL monster the species
// tests are all skipped, leaving "accessible, not the hero, no boulder".
function med_goodpos(x, y) {
    if (!isok(x, y)) return false;
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    if (game.u && game.u.ux === x && game.u.uy === y) return false;
    if (!med_accessible(x, y)) return false;
    for (const o of (game.level?.objects || []))
        if (o && o.otyp === BOULDER && o.ox === x && o.oy === y) return false;
    return true;
}

// C ref: monmove.c:2188 accessible(x, y) — ACCESSIBLE(SURFACE_AT(x,y))
// && !closed_door(x,y).  rm.h's ACCESSIBLE is `typ >= DOOR`, an OPEN-ENDED
// range: DOOR/CORR/ROOM/STAIRS/LADDER/FOUNTAIN/THRONE/SINK/GRAVE/ALTAR/ICE/
// DRAWBRIDGE_DOWN/AIR/CLOUD all pass.  This read `typ >= ROOM && typ <= DOOR`
// with DOOR spelled 25, i.e. exactly ROOM, so a statue spot on any of the
// other thirteen was rejected and fixup_special()'s mk_tt_object() never ran
// (seed0367 step 243).
// C ref: rm.h SURFACE_AT — only a raised drawbridge reports its underlying
// terrain; medusa-N has none, so levl[x][y].typ is the surface.
function med_accessible(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return ACCESSIBLE(loc.typ) && !med_closed_door(loc);
}

// C ref: rm.h closed_door(x,y) == IS_DOOR(typ) && (doormask & (D_LOCKED|D_CLOSED))
function med_closed_door(loc) {
    return loc.typ === DOOR && !!(loc.doormask & (D_LOCKED | D_CLOSED));
}

// C ref: mkmaze.c fixup_special()'s Is_medusa_level() block — the "leaderboard
// statues" that go into svr.rooms[0], the first room each script defines.
function med_fixup_statues() {
    const croom = game.level?.rooms?.[0];
    if (!croom) return;
    for (let tryct = rnd(4); tryct; tryct--) {     // mkmaze.c:654
        const x = somex(croom), y = somey(croom);
        if (!med_goodpos(x, y)) continue;
        const otmp = mk_tt_object(STATUE, x, y);
        let tryct2 = 0;
        while (++tryct2 < 100 && otmp && med_statue_is_stony(otmp))
            set_corpsenm(otmp, med_rndmonnum());
    }
    let otmp;
    if (rn2(2)) {                                  // mkmaze.c:671
        otmp = mk_tt_object(STATUE, somex(croom), somey(croom));
    } else {
        // "Medusa statues don't contain books": mkcorpstat() with a NULL
        // permonst, i.e. mksobj_at(STATUE, x, y, TRUE, FALSE) — whose STATUE
        // arm already rolls the species — and no tt_oname().
        const x = somex(croom), y = somey(croom);
        otmp = mksobj_at(STATUE, x, y, true, false);
    }
    let tryct = 0;
    while (++tryct < 100 && otmp && med_statue_is_stony(otmp))
        set_corpsenm(otmp, med_rndmonnum());
}

function med_statue_is_stony(otmp) {
    const ptr = monster_by_pmidx(otmp.corpsenm);
    if (!ptr) return false;
    return med_poly_when_stoned(ptr) || ((ptr.mresists ?? 0) & MR_STONE) !== 0;
}

// ── prologue / finalize ──────────────────────────────────────────────────

// C ref: load_special() head — nhlib.lua's top-level shuffle(align), then
// des.level_init({style="solidfill", fg=" "}) and des.level_flags(...).
function med_prologue(mapstr, flags) {
    shuffle(['law', 'neutral', 'chaos']);          // nhlib.lua:19
    quest_level_init_solidfill();                  // sp_lev.c:2992 rn2(2)
    const lf = game.level?.flags;
    if (lf) for (const f of flags) lf[f] = true;
    bigrm_load_map(mapstr, false);                 // bare des.map -> lit = FALSE
}

// C ref: load_special()'s tail — link_doors_rooms, remove_boundary_syms,
// map_cleanup, wallification, flip_level_rnd, then fixup_special (the stored
// lregions in registration order, then the Medusa statues).
function med_finalize(lregions) {
    splev_link_doors_rooms();
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                          // sp_lev.c:975
    if (rn2(2)) flp |= 2;                          // sp_lev.c:977
    if (flp) {
        flip_level(flp);
        for (const r of lregions) med_flip_rect(r, 'lx', 'ly', 'hx', 'hy', flp);
        med_flip_rect(game.dndest, 'lx', 'ly', 'hx', 'hy', flp);
        med_flip_rect(game.updest, 'lx', 'ly', 'hx', 'hy', flp);
    }
    for (const r of lregions) med_place_lregion(r);
    med_fixup_statues();
}

// C ref: lspo_teleport_region() dir="up" -> LR_UPTELE -> svu.updest.  The
// dir="down" form is vly_teleport_region() (svd.dndest); a script may set both.
function med_updest(mx1, my1, mx2, my2) {
    const a = vly_abs(mx1, my1), b = vly_abs(mx2, my2);
    game.updest = { lx: a.x, ly: a.y, hx: b.x, hy: b.y,
                    nlx: 0, nly: 0, nhx: 0, nhy: 0 };
}

// selection:set(x,y) stores an absolute coordinate and rndcoord() hands back a
// map-relative one.  A constant offset cannot change the bounding-box walk
// order, so the set is kept map-relative throughout.
function med_places(pts) {
    return new Set(pts.map(([x, y]) => x + ',' + y));
}

// ════════════════════════════════════════════════════════════════════════
// medusa-1: Medusa's building in the middle of a lake.
// ════════════════════════════════════════════════════════════════════════
export async function makemaz_medusa1() {
    med_prologue(MEDUSA1_MAP, ['is_maze_lev', 'noteleport']);

    splev_region_lit(0, 0, 74, 19, 1);
    splev_region_lit(31, 7, 45, 7, 0);
    // fixup_special() fills the FIRST room defined on a Medusa level with
    // leaderboard statues; arrival_room is what forces this region to be one.
    vly_region(35, 9, 41, 10, med_litstate_rnd(0), OROOM, 0, false);
    splev_region_lit(31, 12, 45, 12, 0);

    vly_teleport_region(1, 1, 5, 17, false, 'down');       // dir="down" -> svd.dndest
    med_updest(26, 4, 50, 15);                     // dir="up"   -> svu.updest

    quest_place_stair(5, 14, true);
    quest_place_stair(36, 10, false);

    quest_set_door(46, 7, 'closed');
    quest_set_door(38, 8, 'locked');
    quest_set_door(38, 11, 'locked');
    quest_set_door(30, 12, 'closed');

    // Branch, not allowed inside Medusa's building.
    const lregions = [med_lregion(LR_BRANCH, 1, 0, 79, 20, [30, 6, 46, 13])];
    vly_non_diggable(30, 6, 46, 13);

    med_perseus_statue({ x: 36, y: 10 }, 75, 25);
    for (let i = 0; i < 7; i++) med_object({ otyp: STATUE, spe: 0, contents: 0 });
    for (let i = 0; i < 8; i++) med_object({});

    for (let i = 0; i < 5; i++) await med_trap(-1);
    await med_trap(SQKY_BOARD, 38, 7);
    await med_trap(SQKY_BOARD, 38, 12);

    med_monster({ name: 'Medusa', mx: 36, my: 10, asleep: 1 });
    med_monster({ name: 'giant eel', mx: 11, my: 6 });
    med_monster({ name: 'giant eel', mx: 23, my: 13 });
    med_monster({ name: 'giant eel', mx: 29, my: 2 });
    med_monster({ name: 'jellyfish', mx: 2, my: 2 });
    med_monster({ name: 'jellyfish', mx: 0, my: 8 });
    med_monster({ name: 'jellyfish', mx: 4, my: 18 });
    med_monster({ name: 'water troll', mx: 51, my: 3 });
    med_monster({ name: 'water troll', mx: 64, my: 11 });
    med_monster({ cls: S_SNAKE, mx: 38, my: 7 });
    med_monster({ cls: S_SNAKE, mx: 38, my: 12 });
    for (let i = 0; i < 10; i++) med_monster({});

    med_finalize(lregions);
}

// ════════════════════════════════════════════════════════════════════════
// medusa-2: two walled islands across a maze of water.
// ════════════════════════════════════════════════════════════════════════
export async function makemaz_medusa2() {
    med_prologue(MEDUSA2_MAP, ['is_maze_lev', 'noteleport']);

    splev_region_lit(0, 0, 74, 19, 1);
    splev_region_lit(2, 3, 5, 16, 0);
    // irregular=1 makes this a room, so it becomes svr.rooms[0].
    vly_region(61, 3, 72, 16, med_litstate_rnd(0), OROOM, 0, true);
    splev_region_lit(71, 8, 72, 11, 0);
    vly_region(67, 8, 69, 11, med_litstate_rnd(1), OROOM, 0, false);

    vly_teleport_region(2, 3, 5, 16, false, 'down');       // dir="down"
    med_updest(61, 3, 72, 16);                     // dir="up"

    quest_place_stair(4, 9, true);
    quest_place_stair(68, 10, false);
    quest_set_door(71, 7, 'locked');

    const lregions = [med_lregion(LR_BRANCH, 1, 0, 79, 20, [59, 1, 73, 17])];
    vly_non_diggable(1, 2, 6, 17);
    vly_non_diggable(60, 2, 73, 17);

    med_perseus_statue({ x: 68, y: 10 }, 25, 75);
    for (const [sx, sy] of [[64, 8], [65, 8], [64, 9], [65, 9],
                            [64, 10], [65, 10], [64, 11], [65, 11]])
        med_object({ otyp: STATUE, spe: 0, coord: { x: sx, y: sy }, contents: 0 });
    med_object({ otyp: BOULDER, coord: { x: 4, y: 4 } });
    med_object({ oclass: WAND_CLASS, coord: { x: 52, y: 9 } });   // des.object("/")
    med_object({ otyp: BOULDER, coord: { x: 52, y: 9 } });
    for (let i = 0; i < 6; i++) med_object({});

    await med_trap(MAGIC_TRAP, 3, 12);
    for (let i = 0; i < 4; i++) await med_trap(-1);

    med_monster({ name: 'Medusa', mx: 68, my: 10, asleep: 1 });
    med_monster({ name: 'gremlin', mx: 2, my: 14 });
    med_monster({ name: 'titan', mx: 2, my: 5 });
    for (const [ex, ey] of [[10, 13], [11, 13], [10, 14],
                            [11, 14], [10, 15], [11, 15]])
        med_monster({ name: 'electric eel', mx: ex, my: ey });
    med_monster({ name: 'jellyfish', mx: 1, my: 1 });
    med_monster({ name: 'jellyfish', mx: 0, my: 8 });
    med_monster({ name: 'jellyfish', mx: 4, my: 19 });
    for (const [gx2, gy2] of [[64, 8], [65, 8], [64, 9], [65, 9]])
        med_monster({ name: 'stone golem', mx: gx2, my: gy2, asleep: 1 });
    med_monster({ name: 'cobra', mx: 64, my: 10, asleep: 1 });
    med_monster({ name: 'cobra', mx: 65, my: 10, asleep: 1 });
    med_monster({ cls: S_ANGEL, mx: 72, my: 8 });
    med_monster({ name: 'yellow light', mx: 72, my: 11, asleep: 1 });
    for (const [rx, ry] of [[17, 7], [28, 11], [32, 13], [49, 9], [48, 7],
                            [65, 3], [70, 4], [70, 15], [65, 16]])
        med_monster({ mx: rx, my: ry });
    for (let i = 0; i < 4; i++) med_monster({});

    med_finalize(lregions);
}

// ════════════════════════════════════════════════════════════════════════
// medusa-3: ravens nesting in the trees; Medusa is in one of three rooms.
// ════════════════════════════════════════════════════════════════════════
export async function makemaz_medusa3() {
    med_prologue(MEDUSA3_MAP, ['noteleport', 'is_maze_lev', 'shortsighted']);

    // Three spots, each inside a distinct room.  rndcoord(1,1) removes the
    // point it returns, so the three draws are rn2(3), rn2(2), rn2(1).
    const place = med_places([[8, 6], [66, 5], [46, 15]]);
    const medloc = quest_rndcoord(place);
    const altloc = quest_rndcoord(place);
    const othloc = quest_rndcoord(place);

    splev_region_lit(0, 0, 74, 19, 1);
    vly_region(49, 14, 51, 16, med_litstate_rnd(-1), OROOM, 0, false);
    splev_region_lit(7, 5, 9, 7, 0);
    splev_region_lit(65, 4, 67, 6, 0);
    splev_region_lit(45, 14, 47, 16, 0);

    // The fourth room has diggable walls: Medusa is never placed there.
    vly_non_diggable(6, 4, 10, 8);
    vly_non_diggable(64, 3, 68, 7);
    vly_non_diggable(44, 13, 48, 17);

    vly_teleport_region(33, 2, 38, 7, false, 'down');      // dir="down"
    const lregions = [med_lregion(LR_UPSTAIR, 32, 1, 39, 7)];

    quest_place_stair(medloc.x, medloc.y, false);

    quest_set_door(8, 8, 'locked');
    quest_set_door(64, 5, 'locked');
    splev_door_at('random', 50, 13);               // rnddoor() rn2(5)
    quest_set_door(48, 15, 'locked');

    splev_feature(othloc.x, othloc.y, FOUNTAIN);

    med_perseus_statue(medloc, 75, 25);
    med_object({ otyp: STATUE, spe: 0, coord: altloc, contents: 0 });
    for (let i = 0; i < 6; i++) med_object({ otyp: STATUE, spe: 0, contents: 0 });
    for (let i = 0; i < 8; i++) med_object({});
    med_object({ otyp: SCR_BLANK_PAPER, coord: { x: 48, y: 18 } });
    med_object({ otyp: SCR_BLANK_PAPER, coord: { x: 48, y: 18 } });

    await med_trap(RUST_TRAP);
    await med_trap(RUST_TRAP);
    await med_trap(SQKY_BOARD);
    await med_trap(SQKY_BOARD);
    await med_trap(-1);

    // Medusa first, so nothing else can steal her spot on the downstairs.
    med_monster({ name: 'Medusa', mx: medloc.x, my: medloc.y, asleep: 1 });
    med_monster({ name: 'giant eel' });
    med_monster({ name: 'giant eel' });
    med_monster({ name: 'jellyfish' });
    med_monster({ name: 'jellyfish' });
    med_monster({ name: 'wood nymph' });
    med_monster({ name: 'wood nymph' });
    med_monster({ name: 'water nymph' });
    med_monster({ name: 'water nymph' });
    for (let i = 0; i < 30; i++) med_monster({ name: 'raven', peaceful: 0 });

    med_finalize(lregions);
}

// ════════════════════════════════════════════════════════════════════════
// medusa-4: Medusa's palace of slithery monsters, with a nesting dragon.
// ════════════════════════════════════════════════════════════════════════
export async function makemaz_medusa4() {
    med_prologue(MEDUSA4_MAP, ['noteleport', 'is_maze_lev']);

    // Four downstairs-eligible rooms, only two of them used: rn2(4), rn2(3).
    const place = med_places([[4, 8], [10, 4], [10, 8], [10, 12]]);
    const medloc = quest_rndcoord(place);
    const altloc = quest_rndcoord(place);

    splev_region_lit(0, 0, 74, 19, 1);
    vly_region(13, 3, 18, 13, med_litstate_rnd(1), OROOM, 0, true);

    vly_teleport_region(64, 1, 74, 17, false, 'down');     // dir="down"
    med_updest(2, 2, 18, 13);                      // dir="up"

    const lregions = [med_lregion(LR_UPSTAIR, 67, 1, 74, 20)];

    quest_place_stair(medloc.x, medloc.y, false);

    for (const [dx, dy] of [[4, 6], [4, 10], [8, 4], [8, 12],
                            [10, 6], [10, 10], [12, 8]])
        quest_set_door(dx, dy, 'locked');

    lregions.push(med_lregion(LR_BRANCH, 27, 0, 79, 20));
    vly_non_diggable(1, 1, 22, 14);

    med_object({ otyp: CRYSTAL_BALL, coord: { x: 7, y: 8 } });
    med_perseus_statue(medloc, 75, 25);
    med_object({ otyp: STATUE, spe: 0, coord: altloc, contents: 0 });
    for (let i = 0; i < 6; i++) med_object({ otyp: STATUE, spe: 0, contents: 0 });
    for (let i = 0; i < 8; i++) med_object({});

    for (let i = 0; i < 7; i++) await med_trap(-1);

    med_monster({ name: 'Medusa', mx: medloc.x, my: medloc.y, asleep: 1 });
    med_monster({ name: 'kraken', mx: 7, my: 7 });
    // The nesting dragon.
    med_monster({ name: 'yellow dragon', mx: 5, my: 4, asleep: 1 });
    if (percent(50))
        med_monster({ name: 'baby yellow dragon', mx: 4, my: 4, asleep: 1 });
    if (percent(25))
        med_monster({ name: 'baby yellow dragon', mx: 4, my: 5, asleep: 1 });
    med_object({ otyp: EGG, coord: { x: 5, y: 4 }, montype: 'yellow dragon', spe: 0 });
    if (percent(50))
        med_object({ otyp: EGG, coord: { x: 5, y: 4 }, montype: 'yellow dragon', spe: 0 });
    if (percent(25))
        med_object({ otyp: EGG, coord: { x: 5, y: 4 }, montype: 'yellow dragon', spe: 0 });

    med_monster({ name: 'giant eel' });
    med_monster({ name: 'giant eel' });
    med_monster({ name: 'jellyfish' });
    med_monster({ name: 'jellyfish' });
    for (let i = 0; i < 14; i++) med_monster({ cls: S_SNAKE });
    for (let i = 0; i < 4; i++) {
        med_monster({ name: 'black naga hatchling' });
        med_monster({ name: 'black naga' });
    }

    med_finalize(lregions);
}
