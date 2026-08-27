// levels/quest_common.js — des.* primitives shared by the role-quest map levels
// (Bar-goal, Arc-loca, Arc-goal).  These are the sp_lev.c operators the older
// quest ports did not need, plus a faithful get_location_coord(); they live here
// rather than in sp_lev.js so the quest levels stay self-contained.
//
// Every function is a straight port of one C function, in C's call order.  The
// RNG each one consumes is annotated with its C callsite.

import {
    A_CHAOTIC, A_LAWFUL, A_NEUTRAL, Align2amask, ENGRAVE, LADDER, NO_TRAP, ROCKTRAP,
    STAIRS, WEB,
} from '../const.js';
import { make_engr_at } from '../engrave.js';
import { game } from '../gstate.js';
import { artilist } from '../artifact.js';
import {
    MGEND_NEUTRAL, enexto_spawn, makemon, mkclass, mm_mon_at, monster_by_pmidx,
    name_gender_hint, name_to_pmidx,
} from '../makemon.js';
import { bless, curse, mkobj_at, mksobj_at, unbless, uncurse } from '../mkobj.js';
import { rn2, rnd } from '../rng.js';
import { Can_fall_thru, maketrap } from '../trap.js';
import {
    LOC_DRY, pm_to_humidity, q_absx, q_absy, splev_get_location_rnd, splev_traptype_rnd,
} from '../sp_lev.js';

// C ref: monflags.h G_NOGEN — mkclass()'s "ignore the never-generate flag" arg.
const G_NOGEN = 0x0200;
// C ref: trap.h is_hole(ttyp) — HOLE and TRAPDOOR.
const HOLE_T = 13, TRAPDOOR_T = 14;
function is_hole_t(ttyp) { return ttyp === HOLE_T || ttyp === TRAPDOOR_T; }

// ════════════════════════════════════════════════════════════════════════
// C ref: sp_lev.c get_location_coord(x, y, humidity, croom, crd) for a RANDOM
// coord (SP_COORD_PACK_RANDOM(0), i.e. a des.* with no x/y):
//
//     c = get_unpacked_coord(crd, humidity);   /* is_random, flags = humidity */
//     get_location(x, y, c.getloc_flags | NO_LOC_WARN, croom);
//     if (*x == -1 && *y == -1 && c.is_random)
//         get_location(x, y, humidity, croom);
//
// So a random coord runs get_location TWICE whenever the first pass fails —
// and get_location's failing pass is a full 100-iteration rn2(xsize)/rn2(ysize)
// loop.  For a water-liking monster on a dry level create_monster then repeats
// the whole thing with DRY added, giving 100 + 100 + 1 iterations.  That is the
// dominant term in Arc-loca's and Arc-goal's PRNG stream (18 snakes each), and
// getting it wrong costs 200 draws per snake.
// ════════════════════════════════════════════════════════════════════════
export function quest_getloc_coord_rnd(humidity, nowarn) {
    // splev_get_location_rnd() IS get_location_coord(): it already runs the
    // NO_LOC_WARN pass and then the caller's-flags pass.  Wrapping it in a
    // second copy of that pair ran FOUR 100-iteration loops where C runs two,
    // so every water-liking species on a dry quest level burned 200 extra
    // rn2(xsize)/rn2(ysize) pairs before its DRY retry (seed0361 Arc-loca).
    return splev_get_location_rnd(humidity, !!nowarn);
}

// C ref: sp_lev.c create_monster() placement — the humidity two-step, then the
// MON_AT/enexto relocate, then makemon().
export function quest_place_monster(ptr) {
    if (!ptr) return null;
    const loc = pm_to_humidity(ptr);
    // get_location_coord(&x, &y, loc | NO_LOC_WARN, croom, m->coord)
    let c = quest_getloc_coord_rnd(loc, true);
    if (c.x === -1 && c.y === -1) {
        // loc |= DRY; get_location_coord(&x, &y, loc, croom, m->coord)
        c = quest_getloc_coord_rnd(loc | LOC_DRY, false);
    }
    let x = c.x, y = c.y;
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    return makemon(ptr, x, y, 0 /* NO_MM_FLAGS */);
}

// C ref: sp_lev.c create_monster() for `des.monster("X")` — a bare class char,
// no id, no coord.  find_montype is never reached (no gender roll); the order is
// induced_align -> mkclass(class, G_NOGEN) -> the placement above.
export function quest_monster_class_rnd(classNum, peacefulOverride) {
    rn2(3);                                            // induced_align (dungeon.c:2012)
    const ptr = mkclass(classNum, G_NOGEN);
    if (!ptr) return null;
    const mtmp = quest_place_monster(ptr);
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// C ref: sp_lev.c create_monster() for `des.monster({id="name"})` with no coord.
// find_montype's rn2(2) gender roll comes first (skipped for a fixed-gender
// species or a gendered NAMS() name), then induced_align, then the placement.
export function quest_monster_named_rnd(name, peacefulOverride) {
    const pmidx = name_to_pmidx(name);
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    if (ptr.gcode !== 1 && ptr.gcode !== 2 && name_gender_hint(name) === MGEND_NEUTRAL)
        rn2(2);                                        // find_montype (sp_lev.c:3156)
    rn2(3);                                            // induced_align (dungeon.c:2012)
    const mtmp = quest_place_monster(ptr);
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// C ref: sp_lev.c create_object() for a bare `des.object()` — no class, no id,
// no coord: get_location_coord(DRY) then mkobj_at(RANDOM_CLASS, x, y, TRUE).
export function quest_object_rnd() {
    const c = quest_getloc_coord_rnd(LOC_DRY, false);
    return mkobj_at(0 /* RANDOM_CLASS */, c.x, c.y, true);
}

// C ref: sp_lev.c create_trap() with croom == NULL — the DRY get_location loop
// that rejects STAIRS/LADDER (sp_lev.c:1827-1832).  Returns null when the loop
// gives up after 100 tries (C `return`s without making a trap).
function quest_trap_spot() {
    let x = -1, y = -1, trycnt = 0;
    for (;;) {
        const c = quest_getloc_coord_rnd(LOC_DRY, false);
        x = c.x; y = c.y;
        const t = game.level?.at(x, y)?.typ;
        if (t !== STAIRS && t !== LADDER) break;
        if (++trycnt > 100) return null;
    }
    return { x, y };
}

// C ref: mklev.c mktrap(kind, MKTRAP_MAZEFLAG, NULL, &tm) with an explicit `tm`
// — the placement loop is skipped, so the only draws are the trap's own
// (maketrap: a rolling boulder's launch spot, a statue trap's rndmonnum plus the
// statue's inhabitant) and the victim gate.  A des.trap() leaves spider_on_web
// TRUE, so MKTRAP_NOSPIDERONWEB is clear and a rolled WEB really does come with
// a giant spider.
async function quest_mktrap_at(x, y, kind) {
    // mklev.c:2081 `if (is_hole(kind) && !Can_fall_thru(&u.uz)) kind = ROCKTRAP;`
    if (is_hole_t(kind) && !Can_fall_thru(game.u?.uz)) kind = ROCKTRAP;
    const trap = await maketrap(x, y, kind);
    kind = trap ? trap.ttyp : NO_TRAP;
    if (kind === WEB) {                                // mklev.c:2103
        const pm = monster_by_pmidx(name_to_pmidx('giant spider'));
        if (pm) makemon(pm, x, y, 0);
    }
    // mklev.c:2137 `gi.in_mklev && kind != NO_TRAP && !NOVICTIM && lvl <= rnd(4)
    // && ...` — the rnd(4) is reached (and drawn) whenever a trap was made; the
    // conjuncts after it are only evaluated when it succeeds, which it never
    // does at quest depth (level_difficulty is 11+ there).
    if (kind !== NO_TRAP) rnd(4);
    return trap;
}

// C ref: sp_lev.c create_trap() for `des.trap()` — no type, no coordinate.
export async function quest_trap_random() {
    const spot = quest_trap_spot();
    if (!spot) return null;
    let kind;
    // mklev.c:2074 `do { kind = traptype_rnd(mktrapflags); } while (kind == NO_TRAP);`
    do { kind = splev_traptype_rnd(0); } while (kind === NO_TRAP);
    return quest_mktrap_at(spot.x, spot.y, kind);
}

// C ref: sp_lev.c create_trap() for `des.trap("name")` — a fixed type at a
// random DRY spot.  mktrap takes its `num > NO_TRAP` arm, so traptype_rnd is
// never called and no rnd(TRAPNUM-1) is drawn.
export async function quest_trap_typed_random(ttyp) {
    const spot = quest_trap_spot();
    if (!spot) return null;
    return quest_mktrap_at(spot.x, spot.y, ttyp);
}

// C ref: sp_lev.c create_trap() for `des.trap("name", x, y)` — an explicit
// coord draws no get_location RNG at all.
export async function quest_trap_typed_at(ttyp, mx, my) {
    return quest_mktrap_at(q_absx(mx), q_absy(my), ttyp);
}

// C ref: sp_lev.c lspo_engraving() with no x/y — get_location_coord(DRY) at a
// random spot, then make_engr_at(x, y, txt, NULL, 0L, etyp), which draws nothing
// for an explicit text.
export function quest_engraving_random(text, etyp = ENGRAVE) {
    const c = quest_getloc_coord_rnd(LOC_DRY, false);
    make_engr_at(c.x, c.y, text, text, 0, etyp);
}

// C ref: sp_lev.c create_object() for a des.object table carrying an `id`, an
// explicit coord and a `name`.  `named` suppresses mksobj's artifact roll (C
// passes !named as `artif`); then the spe assignment, then the buc arm.  oname()
// consumes no RNG — it only marks the object as the named artifact.
export function quest_named_object_at(otyp, mx, my, { spe = null, buc = null, name = null } = {}) {
    const x = q_absx(mx), y = q_absy(my);
    const otmp = mksobj_at(otyp, x, y, true, false);   // mksobj_at(id, x, y, TRUE, !named)
    if (!otmp) return null;
    if (spe != null) otmp.spe = spe;
    switch (buc) {
    case 'blessed': bless(otmp); break;
    case 'uncursed': unbless(otmp); uncurse(otmp); break;
    case 'cursed': curse(otmp); break;
    default: break;
    }
    if (name) {
        otmp.oname = name; otmp.onamelth = name.length;
        // C ref: sp_lev.c create_object() -> oname(otmp, name, ONAME_NO_FLAGS):
        // naming an object with an artifact's name MAKES it that artifact and
        // sets artiexist[m].  Skipping that left every quest artifact invisible
        // to nartifact_exist(), so mksobj_init()'s artifact gate rolled
        // rn2(40 + 10*n) with the wrong modulus for the rest of the game.
        for (let m = 1; m < artilist.length; m++) {
            if (artilist[m]?.name === name) {
                otmp.oartifact = m;
                if (!(game.artiexist instanceof Set)) game.artiexist = new Set();
                game.artiexist.add(m);
                break;
            }
        }
    }
    return otmp;
}

// C ref: sp_lev.c noncoalignment(u.ualignbase[A_ORIGINAL]) — the ONE rn2(2)
// behind `align="noncoaligned"`, then Align2amask().  A_ORIGINAL is index 1.
export function quest_noncoaligned_amask() {
    const u = game.u || {};
    const base = u.ualignbase?.[1] ?? u.ualign?.type ?? A_NEUTRAL;
    const k = rn2(2);                                  // sp_lev.c:1856
    let a;
    if (base === A_NEUTRAL) a = k ? A_CHAOTIC : A_LAWFUL;
    else a = k ? -base : A_NEUTRAL;
    return Align2amask(a);
}

// C ref: sp_lev.c aligns[] — the des-file alignment names, as used by
// get_table_align() and by the nhlib.lua `align` table the quest levels index.
export const QUEST_ALIGN_AMASK = {
    law: 0x04 /* AM_LAWFUL */, neutral: 0x02 /* AM_NEUTRAL */, chaos: 0x01 /* AM_CHAOTIC */,
};
