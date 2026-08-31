// dog.js - Pet creation.
// C ref: dog.c - pet_type, makedog.

import { game } from './gstate.js';
import { rn2, rnd, getRngLog } from './rng.js';
import { roles } from './role.js';
import { COLNO, ROWNO, NON_PM, DOOR, W_SADDLE } from './const.js';
import { mksobj, next_ident } from './mkobj.js';
import { set_malign } from './makemon.js';

// C ref: include/onames.h — SADDLE object type index (mkobj.js OBJECTS table
// row [235, "SADDLE", ...]).  A saddle is a TOOL_CLASS object whose
// mksobj_init() has no SADDLE case, so the only RNG it consumes is the single
// rnd(2) inside next_ident() that assigns o_id.
const SADDLE = 235;

// Per-pet display info (class symbol + color).  C ref: include/monsters.h
// (the starting pets).  Pets are drawn in HI_DOMESTIC = CLR_WHITE.
// mflags3: the M3_* flag group (include/monsters.h).  All three starting pets
// are M3_INFRAVISIBLE (0x200) so the hero's infravision reveals them in dark
// corridors (display.c see_with_infrared -> infravisible(mon->data)); the
// kitten additionally has M3_INFRAVISION (0x100).
const PET_DATA = {
    16: { name: 'little dog', mlet: 'd', mcolor: 15, mflags3: 0x200 }, // PM_LITTLE_DOG
    32: { name: 'kitten', mlet: 'f', mcolor: 15, mflags3: 0x300 },     // PM_KITTEN (INFRAVISIBLE|INFRAVISION)
    100: { name: 'pony', mlet: 'u', mcolor: 3, mflags3: 0x200 },       // PM_PONY (brown)
};

export const PM_LITTLE_DOG = 16;
export const PM_KITTEN = 32;
export const PM_PONY = 100;

const ROLE_PETNUM = {
    Caveman: PM_LITTLE_DOG,
    Knight: PM_PONY,
    Ranger: PM_LITTLE_DOG,
    Samurai: PM_LITTLE_DOG,
    Wizard: PM_KITTEN,
};

function current_role_name() {
    if (game.urole?.name?.m)
        return game.urole.name.m;
    if (Number.isInteger(game.initrole))
        return roles[game.initrole]?.name?.m ?? '';
    return '';
}

function role_petnum() {
    if (Number.isInteger(game.urole?.petnum))
        return game.urole.petnum;
    return ROLE_PETNUM[current_role_name()] ?? NON_PM;
}

export function pet_type() {
    const petnum = role_petnum();
    if (petnum !== NON_PM)
        return petnum;
    if (game.preferred_pet === 'c')
        return PM_KITTEN;
    if (game.preferred_pet === 'd')
        return PM_LITTLE_DOG;
    return rn2(2) ? PM_KITTEN : PM_LITTLE_DOG;
}

// C ref: mon.c m_at — monster at <x,y>.
function m_at(x, y) {
    for (const m of game.level?.monsters || [])
        if (m.mx === x && m.my === y) return m;
    return null;
}

// C ref: teleport.c goodpos — minimal version for starting-pet placement:
// accessible terrain, not the hero, no monster already there.
function goodpos(x, y) {
    if (x < 1 || x >= COLNO || y < 0 || y >= ROWNO) return false;
    if (game.u?.ux === x && game.u?.uy === y) return false;
    if (m_at(x, y)) return false;
    const typ = game.level?.at(x, y)?.typ;
    return typ != null && typ >= DOOR; // ACCESSIBLE(typ)
}

// C ref: teleport.c collect_coords — gather candidate spots in expanding
// rings around <cx,cy>, each ring shuffled (consuming RNG identically to
// the C engine), and return them in collection order.  maxradius 0 means
// the whole map.
function collect_coords(cx, cy, maxradius) {
    const out = [];
    const rowrange = (cy < ROWNO / 2) ? (ROWNO - 1 - cy) : cy;
    const colrange = (cx < COLNO / 2) ? (COLNO - 1 - cx) : cx;
    const k = Math.max(rowrange, colrange);
    maxradius = maxradius ? Math.min(maxradius, k) : k;

    for (let radius = 1; radius <= maxradius; radius++) {
        const ringStart = out.length;
        const lox = cx - radius, hix = cx + radius;
        const loy = cy - radius, hiy = cy + radius;
        for (let y = Math.max(loy, 0); y <= hiy; y++) {
            if (y > ROWNO - 1) break;
            for (let x = Math.max(lox, 1); x <= hix; x++) {
                if (x > COLNO - 1) break;
                if (x !== lox && x !== hix && y !== loy && y !== hiy) continue;
                out.push({ x, y });
            }
        }
        // Shuffle this ring's entries (Fisher-Yates), matching C exactly.
        let n = out.length - ringStart;
        let base = ringStart;
        while (n > 1) {
            const kk = rn2(n);
            if (kk) {
                const tmp = out[base];
                out[base] = out[base + kk];
                out[base + kk] = tmp;
            }
            base++;
            n--;
        }
    }
    return out;
}

// C ref: teleport.c enexto_core — first goodpos spot, nearest rings first
// (1-3 steps), then whole map.  Returns {x,y} or null.
function enexto(xx, yy) {
    const near = collect_coords(xx, yy, 3);
    for (const c of near)
        if (goodpos(c.x, c.y)) return c;
    const all = collect_coords(xx, yy, 0);
    for (let i = near.length; i < all.length; i++)
        if (goodpos(all[i].x, all[i].y)) return all[i];
    return null;
}

function logged_d(n, x) {
    const log = getRngLog();
    const start = log.length;
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += rnd(x);
    if (log.length - start === n)
        log.splice(start, n, `d(${n},${x})=${sum}`);
    return sum;
}

function adj_lev(base_level) {
    const depth = game.u?.uz?.dlevel ?? 1;
    const ulevel = game.u?.ulevel ?? 1;
    let tmp = base_level;
    const levdiff = depth - tmp;
    if (levdiff < 0)
        tmp--;
    else
        tmp += Math.trunc(levdiff / 5);

    const udiff = ulevel - base_level;
    if (udiff > 0)
        tmp += Math.trunc(udiff / 4);

    const upper = Math.min(Math.trunc((3 * base_level) / 2), 49);
    return tmp > upper ? upper : (tmp > 0 ? tmp : 0);
}

function pet_base_level(pettype) {
    return pettype === PM_PONY ? 3 : 2;
}

// C ref: makemon.c newmonhp(mtmp, mndx) — set the freshly-created monster's
// m_lev (adj_lev of the species base level) and mhp/mhpmax.  Returns the mlev
// so callers can store it; the hp roll is the same RNG either way.
function newmonhp_for_pet(pettype, mtmp) {
    const mlev = adj_lev(pet_base_level(pettype));
    let basehp, hp;
    if (!mlev) {
        basehp = 1; // C: minimum is 1, increased to 2 below
        hp = rnd(4);
    } else {
        basehp = mlev; // C: minimum possible is one per level
        hp = logged_d(mlev, 8);
    }
    // C ref: makemon.c newmonhp() trailing block — "if d(X,8) rolled a 1 all X
    // times, give a boost", so mhpmax/mhp are never below 2 for a level 0/1
    // monster.  makemon.js's newmonhp() has this; this pet-only copy did not,
    // so a starting pet that rolled the minimum came out with 1 hp instead of
    // 2 — one hit from death, and the divergence then cascades through every
    // fight the pet takes part in.  Consumes no RNG.
    if (hp === basehp) hp = basehp + 1;
    if (mtmp) {
        // C ref: makemon.c newmonhp — m_lev is adj_lev(ptr); a starting pet on
        // dlvl 1 with u.ulevel 1 decrements to base-1 (kitten/dog 1, pony 2).
        mtmp.m_lev = mlev;
        mtmp.mhp = mtmp.mhpmax = hp;
    }
    return mlev;
}

function peace_minded_pet() {
    // C ref: makemon.c peace_minded — co-aligned check first. A starting
    // pet (dog/cat/pony) is neutral (mal=0); if the player's alignment
    // sign differs, the function returns early with NO rng.
    const ual = game.u?.ualign?.type ?? 0;
    const mal = 0; // dog/cat/pony are neutral
    if (Math.sign(mal) !== Math.sign(ual))
        return; // hostile, no roll (academic for forced-tame pet)
    // C ref: u_init.c u_init_misc -> newhp() sets u.ualign.record =
    // gu.urole.initrecord BEFORE makedog(); peace_minded() rolls
    // rn2(16 + record).  initrecord (role.c) is 10 for Archeologist/
    // Barbarian/Healer/Knight/Monk/Ranger/Rogue/Samurai, 0 for Caveman/
    // Priest/Tourist/Valkyrie/Wizard.  Indexed by role.js array position.
    const ROLE_INITRECORD = [10, 10, 0, 10, 10, 10, 0, 10, 10, 10, 0, 0, 0];
    const record = ROLE_INITRECORD[game.initrole] ?? (game.u?.ualign?.record ?? 0);
    if (rn2(16 + (record < -15 ? -15 : record)))
        rn2(2);
}

function makedog_mon(pettype, x, y) {
    // C ref: makemon.c — when the requested spot is the hero's (byyou) and
    // we're past mklev, relocate to the nearest good position via enexto.
    let mx = x, my = y;
    if (x === (game.u?.ux ?? 0) && y === (game.u?.uy ?? 0) && !game.in_mklev) {
        const cc = enexto(x, y);
        if (cc) { mx = cc.x; my = cc.y; }
    }

    const petinfo = PET_DATA[pettype] || { name: 'pet', mlet: 'd', mcolor: 15, mflags3: 0x200 };
    const mtmp = {
        data: { pmidx: pettype, name: petinfo.name, mlet: petinfo.mlet,
                mcolor: petinfo.mcolor,
                // C's mons[] rows give all three starting pets neutral
                // maligntyp.  Keep it on the reduced pet record so the shared
                // set_malign() computes the tame-pet kill penalty correctly.
                maligntyp: 0,
                // mflags3 (M3_*): starting pets are M3_INFRAVISIBLE so the hero's
                // infravision shows them in dark corridors (see_with_infrared).
                mflags3: petinfo.mflags3 ?? 0x200,
                // carnivore/herbivore flags drive dogfood() classification.
                carnivore: pettype !== PM_PONY,
                herbivore: pettype === PM_PONY },
        // C ref: makemon.c / dog.c initedog() — a tamed monster is peaceful
        // (all mtame are mpeaceful).  is_safemon() in the hero's bump-to-swap
        // path keys off mpeaceful, so set it explicitly at creation (before
        // initMonMoveState would otherwise default it to hostile).
        // C ref: makemon.c makemon() sets mtmp->mcanmove = mtmp->mcansee = TRUE
        // and msleeping = 0 on every freshly created monster.  The pet-swap
        // bump path (uhitm.c do_attack -> helpless()) reads mcanmove BEFORE the
        // pet has ever been driven through the move loop (initMonMoveState),
        // so these must be set at creation or the first bump mis-routes to the
        // "doesn't seem to move!" branch instead of swapping places.
        mx, my, mtame: 10, mpeaceful: 1,
        mcanmove: 1, mcansee: 1, msleeping: 0,
        // C ref: dog.c initedog() — edog structure for a freshly-tamed pet.
        // apport = ACURR(A_CHA); the hero's attributes aren't rolled until
        // u_init runs (just after makedog), so leave apport null and resolve it
        // lazily on first use (dogmove.js), once acurr is populated.
        edog: {
            droptime: 0, dropdist: 10000,
            apport: null, // resolved lazily from ACURR(A_CHA)
            whistletime: 0,
            hungrytime: (game.moves || 1) + 1000,
            mhpmax_penalty: 0,
        },
    };
    // C ref: makemon.c:1251 `mtmp->m_id = next_ident()` — the shared
    // object/monster ident counter, NOT a bare rnd(2).  Assigning the increment
    // itself left svc.context.ident two behind C for the rest of the game, so
    // every later m_id/o_id was wrong with the PRNG stream still in lockstep
    // (seed0030 seg3: the Dlvl-2 shopkeeper drew shkgeneral[25] "Kopasker"
    // instead of [23] "Maganasipi", since nameshk() keys on m_id).
    mtmp.m_id = next_ident();
    newmonhp_for_pet(pettype, mtmp);
    // C ref: makemon.c:1279 `mtmp->female = femaleok ? rn2(2) : 0;` — the draw
    // was already emitted here but its RESULT was dropped, leaving every pet
    // male.  could_seduce() (mhitm.js) keys off the defender's gender, so a
    // nymph attacking a female pet says "smiles at ... engagingly" (compat 2)
    // rather than "seductively" (compat 1).
    mtmp.female = rn2(2);
    peace_minded_pet();
    return mtmp;
}

// C ref: steed.c put_saddle_on_mon — when called with a NULL saddle (as
// makedog() does for an initial pony), it creates the saddle itself via
// mksobj(SADDLE, TRUE, FALSE), fully identifies it, gives it to the monster
// (mpickobj), and sets the W_SADDLE worn masks.
//
// RNG: can_saddle()/which_armor()/fully_identify_obj()/mpickobj()/
// update_mon_extrinsics() consume no RNG for this path (the pet is tame, so
// mpickobj()'s !mtame branch is skipped).  The ONLY RNG consumed is the
// single rnd(2) inside mksobj()->next_ident() for the saddle's o_id.  This
// must be emitted in makedog() between makemon() and u_init (matching C),
// which is exactly where the recorded sessions show C emitting an
// rnd(2) @ next_ident(mkobj.c:521).
function put_saddle_on_mon(saddle, mtmp) {
    // can_saddle(pony) is TRUE and which_armor(mtmp, W_SADDLE) is NULL for a
    // freshly created pony, so we always proceed.
    if (!saddle) {
        saddle = mksobj(SADDLE, true, false); // consumes rnd(2) via next_ident
        if (!saddle)
            return;
        saddle.known = saddle.bknown = saddle.rknown = 1; // fully_identify_obj
        saddle.dknown = 1;
    }
    // mpickobj(mtmp, saddle): hand the saddle to the (tame) monster.
    if (!mtmp.minvent) mtmp.minvent = [];
    saddle.where = 'minvent';
    mtmp.minvent.push(saddle);
    // misc_worn_check |= W_SADDLE; saddle->owornmask = W_SADDLE; ...
    mtmp.misc_worn_check = (mtmp.misc_worn_check || 0) | W_SADDLE;
    saddle.owornmask = W_SADDLE;
    saddle.leashmon = mtmp.m_id;
}

export function makedog() {
    const g = game;
    if (g.preferred_pet === 'n') {
        if (!g.context) g.context = {};
        g.context.startingpet_typ = NON_PM;
        return null;
    }

    const pettype = pet_type();
    if (!g.context) g.context = {};
    g.context.startingpet_typ = pettype;

    const mtmp = makedog_mon(pettype, g.u?.ux ?? 0, g.u?.uy ?? 0);
    // C ref: dog.c initedog() — makedog_mon() is intentionally a compact
    // construction path, but it still needs the regular tame-monster
    // alignment value before the pet can later be killed or retamed.
    if (mtmp) set_malign(mtmp);
    if (!g.context.startingpet_mid) {
        g.context.startingpet_mid = mtmp.m_id;
        // C ref: dog.c makedog() — initial horses (PM_PONY) start wearing a
        // saddle, except for a pauper hero.  NULL saddle arg means
        // put_saddle_on_mon() creates the saddle itself, consuming a single
        // rnd(2) inside mksobj(SADDLE)->next_ident() for the saddle's o_id.
        // This must be emitted here (between makemon and u_init) to match C.
        if (!g.u?.uroleplay?.pauper && pettype === PM_PONY)
            put_saddle_on_mon(null, mtmp);
    }

    // C ref: dog.c makedog():232 — the pet's name comes from gd.dogname /
    // gc.catname / gh.horsename (an OPTIONS=dogname: or a `dogname=` config
    // statement; js/options.js records them under flags.<name>), and only when
    // there is none does a little dog fall back to the per-role default:
    // Slasher (Caveman), Hachi (Samurai), Idefix (Barbarian), Sirius (Ranger).
    // christen_monst() stores the name in mtmp->mextra->mgivenname, which
    // x_monnam() then renders standalone (no article).
    if (mtmp) {
        let petname = (pettype === PM_LITTLE_DOG) ? (g.flags?.dogname || '')
                      : (pettype === PM_KITTEN) ? (g.flags?.catname || '')
                        : (pettype === PM_PONY) ? (g.flags?.horsename || '') : '';
        if (!petname && pettype === PM_LITTLE_DOG) {
            const role = current_role_name();
            const DOG_NAMES = { 'Caveman': 'Slasher', 'Samurai': 'Hachi',
                                'Barbarian': 'Idefix', 'Ranger': 'Sirius' };
            petname = DOG_NAMES[role] || '';
        }
        // C: `if (!gp.petname_used++ && *petname)` — only the first pet of the
        // game gets the configured name.
        if (petname && !g.petname_used) mtmp.mgivenname = petname;
        g.petname_used = (g.petname_used || 0) + 1;
    }
    // Place the pet on the level so the renderer can draw it.
    if (mtmp && mtmp.mx > 0 && mtmp.my >= 0 && g.level) {
        if (!g.level.monsters) g.level.monsters = [];
        g.level.monsters.push(mtmp);
    }
    // C ref: dog.c tamedog()/initedog() — u.uconduct.pets++ unconditionally
    // whenever a monster becomes tame, including the starting pet makedog()
    // creates here (the livelog "obtained first pet" message is gated on
    // in_moveloop, but the counter itself is not).
    if (mtmp) {
        if (!g.u.uconduct) g.u.uconduct = {};
        g.u.uconduct.pets = (g.u.uconduct.pets || 0) + 1;
    }
    return mtmp;
}

// ═══════════════════════════════════════════════════════════════════════════
// The rest of src/dog.c — INERT.
//
// Nothing above this banner calls anything below it and no other module
// imports these names yet, so wiring one up is a separate, measured step.
//
// PET RECORD MISMATCH (measured).  makedog_mon() above builds its OWN pet
// record: `data` carries {pmidx, name, mlet, mcolor, mflags3, carnivore,
// herbivore} with no cwt/msize, and its pmidx is not a makemon() index
// (34 = jaguar, 102 = gray unicorn).  Every pmidx-keyed or mons[]-row-keyed
// predicate therefore lies about a starting pet.  The functions below are
// written against C's struct monst / struct edog, i.e. against a makemon()
// monster (js/makemon.js monster_by_pmidx() rows).  Do NOT feed them a
// makedog_mon() pet until that record is reconciled: deduping dogmove's
// PET_MAXLOAD into the shared can_carry() is the same mismatch biting from the
// other side and measured -2296.
//
// LINKED LISTS AS ARRAYS.  C walks three singly-linked monster chains through
// mtmp->nmon: fmon (the live level), gm.migrating_mons and gm.mydogs.  This
// port keeps the live chain as the array game.level.monsters, so the two
// migration chains are modelled as arrays too (game.gm.migrating_mons /
// game.gm.mydogs).  `mtmp->nmon = fmon; fmon = mtmp;` is unshift(); the
// remove-while-walking `*mprev = mtmp->nmon` idiom is an index walk with
// splice().  List ORDER is preserved, which is what movemon() and losedogs()
// observe.
//
// MODULE-PRIVATE HELPERS.  Where the faithful port of a helper already exists
// but is not exported, it is reached through a dynamic import plus a typeof
// probe (never re-implemented); the comment names the file:line whose function
// should be exported when this section is wired up.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: dog.c:14-20 enum arrival.
export const Before_you = 0;   // kept on migrating_mons for accessibility
export const With_you = 1;     // pets and level followers
export const After_you = 2;    // regular migrating monsters
export const Wiz_arrive = -1;  // resurrect(wizard.c)

// C ref: include/monst.h:59-67 mstate bits.
const MON_MIGRATING = 0x04;
const MON_LIMBO = 0x08;
const MON_STILL_ARRIVING = 0x100;
// C ref: include/monst.h STRAT_ARRIVE / STRAT_WAITFORU (js/const.js:1316-1317;
// re-declared locally so this section adds no top-level import and therefore
// cannot reorder ESM evaluation — see [[_mktrap_victim TDZ is real]]).
const STRAT_ARRIVE = 0x40000000;
const STRAT_WAITFORU = 0x20000000;
// C ref: include/dungeon.h MIGR_* (js/const.js:875-889).
const MIGR_RANDOM = 0, MIGR_APPROX_XY = 1, MIGR_EXACT_XY = 2,
      MIGR_STAIRS_UP = 3, MIGR_STAIRS_DOWN = 4, MIGR_LADDER_UP = 5,
      MIGR_LADDER_DOWN = 6, MIGR_SSTAIRS = 7, MIGR_PORTAL = 8,
      MIGR_WITH_HERO = 9, MIGR_LEFTOVERS = 8192;
// C ref: include/trap.h MAGIC_PORTAL.
const MAGIC_PORTAL = 24;
// C ref: include/monsters.h PM_LONG_WORM (makemon.js MONS_NAMES index).
const PM_LONG_WORM = 168;
// C ref: include/worm.h MAX_NUM_WORMS — mon_leave()'s segment-count clamp.
const MAX_NUM_WORMS = 32;
// C ref: include/mon.h G_EXTINCT, include/global.h MAXMONNO.
const G_EXTINCT = 0x01;
const MAXMONNO = 120;
// C ref: makemon.c:1542 mbirth_limit(mndx) — the faithful port is
// module-private at js/makemon.js:1269 (not exported); export that one when
// wiring pick_familiar_pm() up.  Kept as a local constant pair meanwhile so
// this section has no dead call.
const PM_NAZGUL = 231, PM_ERINYS = 292;
function mbirth_limit(mndx) {
    return mndx === PM_NAZGUL ? 9 : mndx === PM_ERINYS ? 3 : MAXMONNO;
}
// C ref: include/onames.h SPE_CREATE_FAMILIAR (js/spell.js:518).
const SPE_CREATE_FAMILIAR = 401;
// C ref: include/objclass.h AT_WEAP / NEED_HTH_WEAPON (monst.h weapon_check).
const AT_WEAP = 4;
const NEED_HTH_WEAPON = 1;
// C ref: include/mkroom.h CORPSTAT_GENDER/_FEMALE/_MALE, makemon.h MM_* flags.
const CORPSTAT_GENDER = 0x03, CORPSTAT_FEMALE = 1, CORPSTAT_MALE = 2;
const NO_MINVENT = 0x00000001, MM_IGNOREWATER = 0x00000008,
      MM_EDOG = 0x00000800, MM_MALE = 0x00008000, MM_FEMALE = 0x00010000,
      MM_NOMSG = 0x00020000;
const RLOC_NOMSG = 0x0001;
// C ref: include/monst.h DISMOUNT_GENERIC / DISMOUNT_THROWN.
const DISMOUNT_THROWN = 1, DISMOUNT_GENERIC = 7;
// C ref: include/trap.h NO_TRAP_FLAGS.
const NO_TRAP_FLAGS = 0x00;

// fmon — the live level's monster chain.
function fmon_list() {
    const lev = game.level;
    if (!lev) return [];
    if (!lev.monsters) lev.monsters = [];
    return lev.monsters;
}

// C ref: decl.c gm.migrating_mons / gm.mydogs.  Neither chain exists in this
// port yet (do.js:418 keepdogs_capture() hands a plain array straight to
// do.js:437 losedogs_place() instead), so they are created on demand here.
function gm_chains() {
    if (!game.gm) game.gm = {};
    const g = game.gm;
    if (!g.migrating_mons) g.migrating_mons = [];
    if (!g.mydogs) g.mydogs = [];
    return g;
}

// C ref: dungeon.c on_level(a, b).
function on_level(a, b) {
    return !!a && !!b && a.dnum === b.dnum && a.dlevel === b.dlevel;
}

// C ref: mon.c relmon(mon, monst_list) — unlink mon from fmon; when a list is
// supplied, push it onto the head of that list instead of freeing it.
// (js/vault.js:217 holds a one-argument module-private copy; export that one
// when this is wired up rather than keeping two.)
function relmon(mon, monst_list) {
    const fm = fmon_list();
    const ix = fm.indexOf(mon);
    if (ix >= 0) fm.splice(ix, 1);
    if (monst_list) monst_list.unshift(mon);
}

// C ref: mon.c m_into_limbo(mtmp) — take mtmp off the map and schedule it to
// migrate back to this level when the hero next arrives.  (js/vault.js:239 is
// the module-private copy; export it when wiring.)
async function m_into_limbo(mtmp) {
    mtmp.mstate = (mtmp.mstate || 0) | MON_LIMBO;
    await migrate_to_level(mtmp, ledger_no(game.u?.uz), MIGR_EXACT_XY, null);
}

// C ref: dungeon.c ledger_no(&dlev) — the flat level index.  (Module-private
// copies live at js/dig.js:924 and js/bones.js:69; export one when wiring.)
function ledger_no(lev) {
    return lev?.dlevel ?? 0;
}

// C ref: mon.c place_monster(mon, x, y) — put mon on the map at <x,y>.
// (js/vault.js:207 is the module-private copy.)
function place_monster(mon, x, y) {
    mon.mx = x;
    mon.my = y;
    const fm = fmon_list();
    if (!fm.includes(mon)) fm.push(mon);
}

// C ref: stairs.c stairway_find_from(fromdlev, isladder) / stairway_find(dlev)
// / stairway_find_dir(up).  The module-private originals are js/do.js:2117 and
// js/do.js:2127; export those when wiring instead of keeping these.
function stairway_find_from(dlev, isladder) {
    if (!dlev) return null;
    for (let s = game.stairs; s; s = s.next)
        if (s.tolev && s.tolev.dnum === dlev.dnum
            && s.tolev.dlevel === dlev.dlevel && !!s.isladder === !!isladder)
            return s;
    return null;
}
function stairway_find(dlev) {
    if (!dlev) return null;
    for (let s = game.stairs; s; s = s.next)
        if (s.tolev && s.tolev.dnum === dlev.dnum
            && s.tolev.dlevel === dlev.dlevel)
            return s;
    return null;
}
function stairway_find_dir(up) {
    for (let s = game.stairs; s; s = s.next)
        if (!!s.up === !!up) return s;
    return null;
}

// C ref: dog.c:22 newedog(mtmp) — attach a zeroed struct edog.  parentmid is
// the clobber-detection field, set to the owning monster's m_id.
export function newedog(mtmp) {
    if (!mtmp.mextra) mtmp.mextra = {};        /* newmextra() */
    if (!mtmp.edog) {
        /* alloc + memset(0), so every field starts at 0 */
        mtmp.edog = {
            parentmid: 0, droptime: 0, dropdist: 0, apport: 0,
            whistletime: 0, hungrytime: 0, ogoal: { x: 0, y: 0 },
            abuse: 0, revivals: 0, mhpmax_penalty: 0, killed_by_u: 0,
        };
        mtmp.edog.parentmid = mtmp.m_id;
    }
}

// C ref: dog.c:34 free_edog(mtmp) — drop the pet extension and untame.
export function free_edog(mtmp) {
    if (mtmp.mextra && mtmp.edog) {
        mtmp.edog = null;
    }
    mtmp.mtame = 0;
}

// C ref: dog.c:103 pick_familiar_pm(otmp, quietly) — which species a figurine
// or the create-familiar spell produces.  RNG: the `!rn2(3)` gate, then either
// nothing (pet_type() can draw rn2(2)) or rndmonst_adj()'s own draws.
export async function pick_familiar_pm(otmp, quietly) {
    const { monster_by_pmidx, rndmonst_adj } = await import('./makemon.js');
    const { pline } = await import('./display.js');
    let pm = null;

    if (otmp) { /* figurine; otherwise spell */
        const mndx = otmp.corpsenm;

        pm = monster_by_pmidx(mndx);
        /* activating a figurine provides one way to exceed the maximum number
           of the target critter created--unless it has a special limit */
        if ((((game.mvitals?.[mndx]?.mvflags) ?? 0) & G_EXTINCT)
            && mbirth_limit(mndx) !== MAXMONNO) {
            if (!quietly)
                await pline('... into a pile of dust.');
            return null;
        }
    } else if (!rn2(3)) {
        pm = monster_by_pmidx(pet_type());
    } else {
        const { spell_skilltype } = await import('./spell.js');
        const { p_skill_of } = await import('./enhance.js');
        const skill = spell_skilltype(SPE_CREATE_FAMILIAR);
        const max = 3 * p_skill_of(skill);   /* P_SKILL(skill) */

        pm = rndmonst_adj(0, max);
        if (!pm && !quietly)
            await pline('There seems to be nothing available for a familiar.');
    }
    return pm;
}

// C ref: dog.c initedog(mtmp, everything).  The faithful port is MODULE-PRIVATE
// at js/dothrow.js:563; the wiring fix is to export it there, not to add a
// second copy here ([[duplicate-reimplementation-shadows-faithful-port]]).
async function initedog_shared(mtmp, everything) {
    const M = await import('./dothrow.js');
    if (typeof M.initedog === 'function')
        return M.initedog(mtmp, everything);
    return undefined;   /* GAP: unreachable until dothrow.js exports it */
}

// C ref: dog.c:137 make_familiar(otmp, x, y, quietly) — a figurine or the
// create-familiar spell.  RNG order: pick_familiar_pm() then makemon() per
// retry (up to 100), minliquid() on water, then the figurine rn2(10).
export async function make_familiar(otmp, x, y, quietly) {
    const { makemon } = await import('./makemon.js');
    const { pline } = await import('./display.js');
    let pm, mtmp = null, chance, trycnt = 100;
    let reallytame = true;

    do {
        let mmflags;
        let cgend;

        if (!(pm = await pick_familiar_pm(otmp, quietly)))
            break;

        mmflags = MM_EDOG | MM_IGNOREWATER | NO_MINVENT | MM_NOMSG;
        cgend = otmp ? (otmp.spe & CORPSTAT_GENDER) : 0;
        mmflags |= ((cgend === CORPSTAT_FEMALE) ? MM_FEMALE
                    : (cgend === CORPSTAT_MALE) ? MM_MALE : 0);

        mtmp = makemon(pm, x, y, mmflags);
        if (otmp) { /* figurine */
            if (!mtmp) {
                /* monster has been genocided or target spot is occupied */
                if (!quietly)
                    await pline('The figurine writhes and then shatters into pieces!');
                break;
            } else if (mtmp.isminion) {
                /* don't let a figurine of an Angel come out as a minion */
                mtmp.isminion = 0;
                mtmp.emin = null;     /* free_emin(mtmp) */
            }
        }
    } while (!mtmp && --trycnt > 0);

    if (!mtmp)
        return null;

    const { is_pool } = await import('./dbridge.js');
    const MON = await import('./mon.js');
    if (is_pool(mtmp.mx, mtmp.my)
        /* C ref: mon.c minliquid(); the faithful port is module-private at
           js/mon.js:591 — export it rather than duplicating. */
        && (typeof MON.minliquid === 'function'
            ? await MON.minliquid(mtmp) : false))
        return null;

    if (otmp) { /* figurine; resulting monster might not become a pet */
        chance = rn2(10); /* 0==tame, 1==peaceful, 2==hostile */
        if (chance > 2)
            chance = otmp.blessed ? 0 : !otmp.cursed ? 1 : 2;
        /* 0,1,2:  b=80%,10,10; nc=10%,80,10; c=10%,10,80 */
        if (chance > 0) {
            reallytame = false; /* not tame after all */
            if (chance === 2) { /* hostile (cursed figurine) */
                if (!quietly)
                    await pline('You get a bad feeling about this.');
                mtmp.mpeaceful = 0;
                const { set_malign } = await import('./makemon.js');
                set_malign(mtmp);
            }
        }
        /* if figurine has been named, give same name to the monster */
        if (otmp.oname) {
            const { christen_monst } = await import('./do_name.js');
            mtmp = christen_monst(mtmp, otmp.oname);
        }
    }
    if (reallytame)
        await initedog_shared(mtmp, true);
    mtmp.msleeping = 0;
    const { set_malign } = await import('./makemon.js');
    set_malign(mtmp); /* more alignment changes */
    const { newsym } = await import('./display.js');
    newsym(mtmp.mx, mtmp.my);

    /* must wield weapon immediately since pets will otherwise drop it */
    const { attacktype } = await import('./monattk_data.js');
    if (mtmp.mtame && attacktype(mtmp.data, AT_WEAP)) {
        mtmp.weapon_check = NEED_HTH_WEAPON;
        const { mon_wield_item } = await import('./monmove.js');
        await mon_wield_item(mtmp);
    }
    return mtmp;
}

// C ref: dog.c:286 set_mon_lastmove(mtmp).
export function set_mon_lastmove(mtmp) {
    mtmp.mlstmv = game.moves;
}

// C ref: dog.c:294 update_mlstmv() — record `last move time' for every monster
// before a level save so that mon_arrive() can catch up for the lost time.
export async function update_mlstmv() {
    const { iter_mons } = await import('./mon.js');
    await iter_mons(set_mon_lastmove);
}

/* note: always reset when used so doesn't need to be part of struct 'g' */
let failed_arrivals = null;

// C ref: dog.c:303 losedogs() — place everything that should arrive on the
// level the hero just entered, in C's five-step order.  The only RNG is inside
// mon_arrive() (its rn2(10)/rn2(5)/rn2(2), mnexto()/rloc() searches and
// mon_catchup_elapsed_time()).
export async function losedogs() {
    const g = gm_chains();
    const uz = game.u?.uz ?? { dnum: 0, dlevel: 0 };
    let mtmp, dismissKops = 0, xyloc;

    failed_arrivals = null;

    /* check for returning shk(s) */
    for (const m of g.migrating_mons) {
        if (m.mux !== uz.dnum || m.muy !== uz.dlevel)
            continue;
        if (m.isshk) {
            if (m.eshk?.dismiss_kops) {
                if (dismissKops === 0)
                    dismissKops = 1;
                m.eshk.dismiss_kops = false; /* reset */
            } else if (!m.mpeaceful) {
                /* an unpacified shk is returning; don't dismiss kops even if
                   another pacified one is willing to do so */
                dismissKops = -1;
            }
        }
    }
    /* make the same check for gm.mydogs */
    for (const m of g.mydogs) {
        if (dismissKops < 0) break;
        if (m.isshk) {
            if (!m.mpeaceful)
                dismissKops = -1;
        }
    }

    /* when a hostile shopkeeper chases hero to another level and then gets
       paid off there, get rid of summoned kops here now that he has returned */
    if (dismissKops > 0) {
        const { make_happy_shoppers } = await import('./shk.js');
        await make_happy_shoppers(true);
    }

    /* put monsters who went onto migrating_mons in order to be accessible when
       other levels were active back to their positions on this level */
    for (let i = 0; i < g.migrating_mons.length; ) {
        mtmp = g.migrating_mons[i];
        xyloc = mtmp.mtrack?.[0]?.x ?? 0;   /* (for legibility) */
        if (mtmp.mux === uz.dnum && mtmp.muy === uz.dlevel
            && xyloc === MIGR_EXACT_XY) {
            g.migrating_mons.splice(i, 1);  /* *mprev = mtmp->nmon */
            await mon_arrive(mtmp, Before_you);
        } else {
            i++;                            /* mprev = &mtmp->nmon */
        }
    }

    /* place pets and/or any other monsters who accompany hero */
    while (g.mydogs.length) {
        mtmp = g.mydogs.shift();
        await mon_arrive(mtmp, With_you);
    }

    /* time for migrating monsters to arrive */
    for (let i = 0; i < g.migrating_mons.length; ) {
        mtmp = g.migrating_mons[i];
        xyloc = mtmp.mtrack?.[0]?.x ?? 0;
        if (mtmp.mux === uz.dnum && mtmp.muy === uz.dlevel
            && xyloc !== MIGR_EXACT_XY) {
            g.migrating_mons.splice(i, 1);
            /* note: if there's no room, it ends up on failed_arrivals */
            await mon_arrive(mtmp, After_you);
        } else {
            i++;
        }
    }

    /* put any monsters who couldn't arrive back on migrating_mons */
    while (failed_arrivals) {
        mtmp = failed_arrivals;
        failed_arrivals = mtmp.nmon;
        /* mon_arrive() put mtmp onto fmon, but relmon() took it off again;
           put it back now because m_into_limbo() expects it to be there */
        fmon_list().unshift(mtmp);
        await m_into_limbo(mtmp);
    }
}

// C ref: dog.c relmon(mtmp, &failed_arrivals) — the failed-arrival list is a
// bare `struct monst *` chained through nmon, so it is kept as a chain here
// rather than an array (losedogs() above drains it through mtmp->nmon).
function relmon_to_failed(mtmp) {
    const fm = fmon_list();
    const ix = fm.indexOf(mtmp);
    if (ix >= 0) fm.splice(ix, 1);
    mtmp.nmon = failed_arrivals;
    failed_arrivals = mtmp;
}

// C ref: dog.c:419 mon_arrive(mtmp, when) — also called from resurrect().
export async function mon_arrive(mtmp, when) {
    const u = game.u;
    let t;
    let xlocale, ylocale, xyloc, xyflags;
    let wander;
    let num_segs;
    let failed_to_place = false;
    let stway;
    const fromdlev = { dnum: 0, dlevel: 0 };

    mtmp.mstate = (mtmp.mstate || 0) | MON_STILL_ARRIVING;
    fmon_list().unshift(mtmp);   /* mtmp->nmon = fmon; fmon = mtmp; */
    if (mtmp.isshk) {
        const { set_residency } = await import('./shk.js');
        set_residency(mtmp, false);
    }

    num_segs = mtmp.wormno;
    /* baby long worms have no tail so don't use is_longworm() */
    if (mtmp.data?.pmidx === PM_LONG_WORM) {
        const { get_wormno, initworm } = await import('./worm.js');
        mtmp.wormno = get_wormno();
        if (mtmp.wormno)
            initworm(mtmp, num_segs);
    } else {
        mtmp.wormno = 0;
    }

    /* some monsters might need to do something special upon arrival
       _after_ the current level has been fully set up; see dochug() */
    mtmp.mstrategy = (mtmp.mstrategy || 0) | STRAT_ARRIVE;
    mtmp.mstate &= ~(MON_MIGRATING | MON_LIMBO);

    /* make sure mnexto(rloc_to(set_apparxy())) doesn't use stale data */
    mtmp.mux = u.ux; mtmp.muy = u.uy;
    xyloc = mtmp.mtrack?.[0]?.x ?? 0;
    xyflags = mtmp.mtrack?.[0]?.y ?? 0;
    xlocale = mtmp.mtrack?.[1]?.x ?? 0;
    ylocale = mtmp.mtrack?.[1]?.y ?? 0;
    fromdlev.dnum = mtmp.mtrack?.[2]?.x ?? 0;
    fromdlev.dlevel = mtmp.mtrack?.[2]?.y ?? 0;
    mtmp.mtrack = [];            /* mon_track_clear(mtmp) */
    /* in case Protection_from_shape_changers changed while mtmp was away */
    {
        const MON = await import('./mon.js');
        await MON.restore_cham(mtmp);
    }

    if (mtmp === u.usteed)
        return; /* don't place steed on the map */
    if (when === With_you) {
        /* When a monster accompanies you, sometimes it will arrive at your
           intended destination and you'll end up next to that spot. */
        /* MON_AT(u.ux, u.uy) — m_at() is the module-private copy at the top of
           this file (dog.js:66); js/display.js:326 exports the shared one. */
        if (!m_at(u.ux, u.uy)
            && !rn2(mtmp.mtame ? 10 : mtmp.mpeaceful ? 5 : 2)) {
            const { rloc_to } = await import('./teleport.js');
            await rloc_to(mtmp, u.ux, u.uy);
        } else {
            const { mnexto_rloc } = await import('./do.js');
            await mnexto_rloc(mtmp, RLOC_NOMSG);
        }
        mtmp.mstate &= ~MON_STILL_ARRIVING;
        return;
    } else if (when === Wiz_arrive) {
        /* resurrect() is bringing existing wizard to harass the hero */
        xyloc = MIGR_WITH_HERO;
    }
    /*
     * The monster arrived on this level independently of the player.
     * Its coordinate fields were overloaded for use as flags that
     * specify its final destination.
     */

    if (mtmp.mlstmv < game.moves - 1) {
        /* heal monster for time spent in limbo */
        const nmv = game.moves - 1 - mtmp.mlstmv;
        const { mon_catchup_elapsed_time } = await import('./dogmove.js');

        mon_catchup_elapsed_time(mtmp, nmv);

        /* let monster move a bit on new level (see placement code below) */
        wander = Math.min(nmv, 8);
    } else {
        wander = 0;
    }

    let fell_through_to_random = false;
    switch (xyloc) {
    case MIGR_APPROX_XY: /* {x,y}locale set above */
        break;
    case MIGR_EXACT_XY:
        wander = 0;
        break;
    case MIGR_WITH_HERO:
        xlocale = u.ux; ylocale = u.uy;
        break;
    case MIGR_STAIRS_UP:
        if ((stway = stairway_find_from(fromdlev, false)) !== null) {
            xlocale = stway.sx; ylocale = stway.sy;
        }
        break;
    case MIGR_STAIRS_DOWN:
        if ((stway = stairway_find_from(fromdlev, false)) !== null) {
            xlocale = stway.sx; ylocale = stway.sy;
        }
        break;
    case MIGR_LADDER_UP:
        if ((stway = stairway_find_from(fromdlev, true)) !== null) {
            xlocale = stway.sx; ylocale = stway.sy;
        }
        break;
    case MIGR_LADDER_DOWN:
        if ((stway = stairway_find_from(fromdlev, true)) !== null) {
            xlocale = stway.sx; ylocale = stway.sy;
        }
        break;
    case MIGR_SSTAIRS:
        if ((stway = stairway_find(fromdlev)) !== null) {
            xlocale = stway.sx; ylocale = stway.sy;
        }
        break;
    case MIGR_PORTAL: {
        const { In_endgame } = await import('./const.js');
        if (In_endgame(u.uz)) {
            /* there is no arrival portal for endgame levels */
            const up = game.updest || { lx: 0, ly: 0, hx: 0, hy: 0 };
            xlocale = rn1(up.hx - up.lx + 1, up.lx);
            ylocale = rn1(up.hy - up.ly + 1, up.ly);
            break;
        }
        /* find the arrival portal.  C walks gf.ftrap through ->ntrap; this
           port keeps the level's traps in a flat array (js/trap.js:236), so
           the equivalent walk is in insertion order. */
        t = (game.level?.traps ?? []).find((tr) => tr.ttyp === MAGIC_PORTAL)
            || null;
        if (t) {
            xlocale = t.tx; ylocale = t.ty;
            break;
        } else if (game.iflags?.debug_fuzzer) {
            const { builds_up } = await import('./dungeon.js');
            if ((stway = stairway_find_dir(!builds_up(u.uz))) !== null) {
                xlocale = stway.sx; ylocale = stway.sy;
                break;
            }
        }
        /* C: impossible("mon_arrive: no corresponding portal?") unless the
           quest expulsion is in progress, then FALLTHRU to MIGR_RANDOM */
        fell_through_to_random = true;
        break;
    }
    default:
    case MIGR_RANDOM:
        fell_through_to_random = true;
        break;
    }
    if (fell_through_to_random)
        xlocale = ylocale = 0;

    if (((mtmp.migflags || 0) & MIGR_LEFTOVERS) !== 0) {
        /* Pick up the rest of the MIGR_TO_SPECIES objects */
        /* C ref: mkobj.c deliver_obj_to_mon(mtmp, 0, DF_ALL) — UNPORTED, so
           the leftover delivery is skipped rather than mis-ordered. */
        void 0;
    }

    if (xlocale && wander) {
        /* monster moved a bit; pick a nearby location */
        const { in_rooms } = await import('./shkroom.js');
        const r = in_rooms(xlocale, ylocale, 0);

        if (r && r.length) {
            const { somexy } = await import('./mkroom.js');
            const c = { x: 0, y: 0 };
            const croom = game.level?.rooms?.[r.charCodeAt(0) - 3 /*ROOMOFFSET*/];

            /* somexy() handles irregular rooms */
            if (croom && somexy(croom, c)) {
                xlocale = c.x; ylocale = c.y;
            } else {
                xlocale = ylocale = 0;
            }
        } else { /* not in a room */
            let i, j;

            i = Math.max(1, xlocale - wander);
            j = Math.min(COLNO - 1, xlocale + wander);
            xlocale = rn1(j - i, i);
            i = Math.max(0, ylocale - wander);
            j = Math.min(ROWNO - 1, ylocale + wander);
            ylocale = rn1(j - i, i);
        }
    } /* moved a bit */

    mtmp.mx = 0; /*(already is 0)*/
    mtmp.my = xyflags;

    if (xlocale) {
        const { mnearto } = await import('./mon.js');
        failed_to_place = !(await mnearto(mtmp, xlocale, ylocale, false,
                                         RLOC_NOMSG));
    } else {
        const { rloc } = await import('./teleport.js');
        failed_to_place = !(await rloc(mtmp, RLOC_NOMSG));
    }

    if (failed_to_place) {
        if (when !== Wiz_arrive)
            /* losedogs() will deal with this */
            relmon_to_failed(mtmp);
        else /* when==Wiz_arrive => not being called by losedogs() */
            await m_into_limbo(mtmp);
    }
    mtmp.mstate &= ~MON_STILL_ARRIVING;
}

// C ref: dog.c:728 mon_leave(mtmp) — bookkeeping when mtmp is about to leave
// the current level; common to keepdogs() and migrate_to_level().  Returns the
// (possibly truncated) worm segment count.
export async function mon_leave(mtmp) {
    let num_segs = 0; /* return value */

    /* set minvent's obj->no_charge to 0 */
    for (const obj of mtmp.minvent || []) {
        if (obj.cobj || Array.isArray(obj.contents)) {
            /* C ref: pickup.c picked_container(obj) — module-private at
               js/shk.js:601 (js/invent.js:415 is a stub); export the shk.js
               one when wiring rather than adding a third copy. */
            const SHK = await import('./shk.js');
            if (typeof SHK.picked_container === 'function')
                SHK.picked_container(obj);
        }
        obj.no_charge = 0;
    }

    /* if this is a shopkeeper, clear the 'resident' field of her shop */
    if (mtmp.isshk) {
        const { set_residency } = await import('./shk.js');
        set_residency(mtmp, true);
    }

    /* if this is a long worm, handle its tail segments before mtmp itself */
    if (mtmp.wormno) {
        const { count_wsegs, wormgone } = await import('./worm.js');
        const cnt = count_wsegs(mtmp), mx = mtmp.mx, my = mtmp.my;

        /* wormno is overloaded to hold the segment count during migration, so
           a worm with more segments than fit in that field gets truncated */
        num_segs = Math.min(cnt, MAX_NUM_WORMS - 1);
        wormgone(mtmp);
        /* put the head back; mtmp might not be on the map if this is a failed
           attempt to migrate to this level */
        if (mx)
            place_monster(mtmp, mx, my);
    }

    return num_segs;
}

// C ref: dog.c:767 keep_mon_accessible(mon) — when the hero leaves a level,
// should mon go onto migrating_mons instead of into the level's save file?
export function keep_mon_accessible(mon) {
    const uz = game.u?.uz;
    /* the Wizard is kept accessible so that his harassment can fetch him
       instead of creating a new instance */
    if (mon.iswiz)
        return true;
    /* monsters with special attachment to a particular level only need to be
       kept accessible when on some other level */
    if (mon.mextra
        && ((mon.isshk && !on_level(uz, mon.eshk?.shoplevel))
            || (mon.ispriest && !on_level(uz, mon.epri?.shrlevel))
            || (mon.isgd && !on_level(uz, mon.egd?.gdlevel))))
        return true;
    /* normal monsters go into the level save file */
    return false;
}

// C ref: dog.c:788 keepdogs(pets_only) — called when the hero moves to another
// level.  RNG: mintrap() for a trapped follower, and nothing else.
// (do.js:418 keepdogs_capture() is the live REDUCED copy: it has no pets_only
// arm, no stay_behind messages, no mon_leave()/worm handling and no
// keep_mon_accessible() branch.  A wiring pass must REPLACE it, not add a
// second caller.)
export async function keepdogs(pets_only) {
    const u = game.u;
    const { DEADMONSTER } = await import('./mon.js');
    const { monnear } = await import('./dogmove.js');
    const { pline } = await import('./display.js');
    const g = gm_chains();

    /* fmon walk; mtmp2 is captured first because mtmp leaves the chain */
    const chain = fmon_list().slice();
    for (const mtmp of chain) {
        if (DEADMONSTER(mtmp))
            continue;
        if (pets_only) {
            if (!mtmp.mtame)
                continue; /* reject non-pets */
            /* don't block pets from accompanying the hero's escape or
               ascension simply due to mundane trifles */
            mtmp.mtrapped = 0;
            await finish_meating_shared(mtmp);
            mtmp.msleeping = 0;
            mtmp.mfrozen = 0;
            mtmp.mcanmove = 1;
        }
        if (((monnear(mtmp, u.ux, u.uy) && levl_follower_shared(mtmp))
             /* the wiz will level t-port from anywhere to chase the amulet */
             || (u.uhave?.amulet && mtmp.iswiz))
            && (!helpless_mon(mtmp)
                /* eg if level teleport or new trap, steed has no control */
                || (mtmp === u.usteed))
            /* monster won't follow if it hasn't noticed you yet */
            && !((mtmp.mstrategy || 0) & STRAT_WAITFORU)) {
            let num_segs;
            let stay_behind = false;

            if (mtmp.mtrapped) {
                /* C ref: trap.c mintrap(mtmp, NO_TRAP_FLAGS) — try to escape.
                   UNPORTED (no mintrap in js/), so the escape roll is skipped
                   rather than mis-ordered; wiring this up needs mintrap. */
                void NO_TRAP_FLAGS;
            }
            if (mtmp === u.usteed) {
                /* make sure steed is eligible to accompany hero */
                mtmp.mtrapped = 0;       /* escape trap */
                mtmp.meating = 0;        /* terminate eating */
                /* C ref: steal.c mdrop_special_objs(mtmp) — UNPORTED */
            } else if (mtmp.meating || mtmp.mtrapped) {
                if (await canseemon_shared(mtmp))
                    await pline(`${await Monnam_shared(mtmp)} is still `
                                + `${mtmp.meating ? 'eating' : 'trapped'}.`);
                stay_behind = true;
            } else if (mon_has_amulet_shared(mtmp)) {
                if (await canseemon_shared(mtmp))
                    await pline(`${await Monnam_shared(mtmp)} seems very`
                                + ' disoriented for a moment.');
                stay_behind = true;
            }
            if (stay_behind) {
                if (mtmp.mleashed) {
                    const { humanoid } = await import('./monflags_data.js');
                    await pline(`${humanoid(mtmp.data)
                                    ? (mtmp.female ? 'Her' : 'His')
                                    : 'Its'} leash suddenly comes loose.`);
                    const { m_unleash } = await import('./apply.js');
                    await m_unleash(mtmp, false);
                }
                if (mtmp === u.usteed) {
                    /* can't happen unless the stay_behind logic is scrambled */
                    await dismount_steed_shared(DISMOUNT_GENERIC);
                }
                continue;
            }

            /* prepare to take mtmp off the map */
            num_segs = await mon_leave(mtmp);
            /* take off map and move mtmp from fmon list to mydogs */
            relmon(mtmp, g.mydogs); /* mtmp->mx,my retain current value */
            mtmp.mx = mtmp.my = 0;  /* mx==0 implies migrating */
            mtmp.wormno = num_segs;
            mtmp.mlstmv = game.moves;
        } else if (keep_mon_accessible(mtmp)) {
            /* keep the Wizard (and anyone with level data in mextra) findable
               while still able to resume their present location */
            await migrate_to_level(mtmp, ledger_no(u.uz), MIGR_EXACT_XY, null);
        } else if (mtmp.mleashed) {
            /* can happen if the quest leader ejects you while a leashed pet
               isn't next to you */
            await pline(`${await Monnam_shared(mtmp)}'s leash goes slack.`);
            const { m_unleash } = await import('./apply.js');
            await m_unleash(mtmp, false);
        }
    }
}

// C ref: include/monst.h helpless(mon) = (mon->msleeping || !mon->mcanmove).
function helpless_mon(mon) {
    return !!(mon.msleeping || !mon.mcanmove);
}
// C ref: mondata.c levl_follower(mtmp).  The faithful port is module-private at
// js/do.js:382; export that one when wiring rather than duplicating it.
function levl_follower_shared(mtmp) {
    return !!(mtmp === game.u?.usteed || mtmp.mtame || mtmp.iswiz);
}
// C ref: wizard.c mon_has_amulet(mtmp) — js/wizard.js exports the real one; a
// dynamic import cannot be awaited from this sync helper, so the caller above
// uses this narrow form (AMULET_OF_YENDOR is otyp 211).
function mon_has_amulet_shared(mtmp) {
    return (mtmp.minvent || []).some((o) => o.otyp === 211);
}
async function canseemon_shared(mtmp) {
    const D = await import('./display.js');
    return typeof D.canseemon_shared === 'function'
        ? D.canseemon_shared(mtmp) : false;
}
async function Monnam_shared(mtmp) {
    const { Monnam } = await import('./do_name.js');
    return Monnam(mtmp);
}
// C ref: mon.c finish_meating(mtmp) — module-private at js/dogmove.js:2300.
async function finish_meating_shared(mtmp) {
    const DM = await import('./dogmove.js');
    if (typeof DM.finish_meating === 'function') DM.finish_meating(mtmp);
    else mtmp.meating = 0;   /* GAP: dogmove.js does not export it */
}
// C ref: steed.c dismount_steed(reason) — UNPORTED in js/.
async function dismount_steed_shared(_reason) { return undefined; }

// C ref: dog.c:886 migrate_to_level(mtmp, tolev, xyloc, cc).  Coverage credits
// this name from a COMMENT ([[coverage-counts-comment-lines]]); there was no
// real port, and keepdogs()/m_into_limbo() above both need it.
export async function migrate_to_level(mtmp, tolev, xyloc, cc) {
    const u = game.u;
    const new_lev = { dnum: 0, dlevel: 0 };
    let xyflags;
    const mx = mtmp.mx, my = mtmp.my; /* <mx,my> needed below */
    let num_segs;                     /* count of worm segments */
    const g = gm_chains();

    if (mtmp.mleashed) {
        mtmp.mtame--;
        const { m_unleash } = await import('./apply.js');
        await m_unleash(mtmp, true);
    }

    /* prepare to take mtmp off the map */
    num_segs = await mon_leave(mtmp);
    /* take off map and move mtmp from fmon list to migrating_mons */
    relmon(mtmp, g.migrating_mons); /* mtmp->mx,my retain their value */
    mtmp.mstate = (mtmp.mstate || 0) | MON_MIGRATING;

    const { ledger_to_dnum, ledger_to_dlev } = await import('./dungeon.js');
    const { depth } = await import('./hacklib.js');
    new_lev.dnum = ledger_to_dnum(tolev);
    new_lev.dlevel = ledger_to_dlev(tolev);
    /* overload mtmp->[mx,my], mtmp->[mux,muy] and mtmp->mtrack[] as
       destination codes */
    xyflags = (depth(new_lev) < depth(u.uz)) ? 1 : 0; /* 1 => up */
    /* C ref: dungeon.c In_W_tower(mx, my, &u.uz) — UNPORTED; the |= 2 flag is
       Vlad's tower only. */
    mtmp.wormno = num_segs;
    mtmp.mlstmv = game.moves;
    if (!Array.isArray(mtmp.mtrack)) mtmp.mtrack = [];
    for (let i = 0; i < 3; i++)
        if (!mtmp.mtrack[i]) mtmp.mtrack[i] = { x: 0, y: 0 };
    mtmp.mtrack[2].x = u.uz.dnum;    /* migrating from this dungeon */
    mtmp.mtrack[2].y = u.uz.dlevel;  /* migrating from this dungeon level */
    mtmp.mtrack[1].x = cc ? cc.x : mx;
    mtmp.mtrack[1].y = cc ? cc.y : my;
    mtmp.mtrack[0].x = xyloc;
    mtmp.mtrack[0].y = xyflags;
    mtmp.mux = new_lev.dnum;
    mtmp.muy = new_lev.dlevel;
    mtmp.mx = mtmp.my = 0; /* mx==0 implies migrating */

    /* don't extinguish a mobile light; it still exists but has changed from
       local (monst->mx > 0) to global (mx==0, not on this level) */
    const { emits_light } = await import('./light.js');
    if (emits_light(mtmp.data)) {
        const { vision_recalc } = await import('./vision.js');
        vision_recalc(0);
    }
}

// C ref: dog.c:937 discard_migrations() — entering the endgame discards every
// dungeon level, so monsters and objects scheduled to migrate there go too.
export async function discard_migrations() {
    const { In_endgame } = await import('./const.js');
    const { discard_minvent } = await import('./mkobj.js');
    const { dealloc_monst } = await import('./mon.js');
    const { emits_light } = await import('./light.js');
    const { del_light_source } = await import('./light.js');
    const { monst_to_any } = await import('./hack.js');
    const { obfree } = await import('./invent.js');
    const g = gm_chains();
    const dest = { dnum: 0, dlevel: 0 };
    const LS_MONSTER = 1;   /* C ref: include/light.h */

    for (let i = 0; i < g.migrating_mons.length; ) {
        const mtmp = g.migrating_mons[i];
        dest.dnum = mtmp.mux;
        dest.dlevel = mtmp.muy;
        /* the Wizard is kept regardless of location; nothing should be
           scheduled to migrate to the endgame but keep any we find */
        if (mtmp.iswiz || In_endgame(dest)) {
            i++;                                /* keep on migrating_mons */
        } else {
            g.migrating_mons.splice(i, 1);      /* remove from the chain */
            mtmp.nmon = null;
            discard_minvent(mtmp, false);
            /* bypass mongone() and its m_detach() plus dmonsfree() */
            if (emits_light(mtmp.data))
                del_light_source(LS_MONSTER, monst_to_any(mtmp));
            dealloc_monst(mtmp);
        }
    }

    /* objects get similar treatment */
    if (!g.migrating_objs) g.migrating_objs = [];
    for (let i = 0; i < g.migrating_objs.length; ) {
        const otmp = g.migrating_objs[i];
        dest.dnum = otmp.ox;
        dest.dlevel = otmp.oy;
        if (In_endgame(dest)) {
            i++;                                /* keep on migrating_objs */
        } else {
            /* bypass obj_extract_self() */
            g.migrating_objs.splice(i, 1);
            otmp.nobj = null;
            otmp.where = 'free';                /* OBJ_FREE */
            otmp.owornmask = 0;                 /* overloaded for destination */
            obfree(otmp, null);                 /* releases any contents too */
        }
    }
}

// C ref: dog.c:1291 wary_dog(mtmp, was_dead) — pet revival / life-saving.
// RNG: the abuse rn2(abuse+1), else rn2(mtame+1) and possibly rn2(2).
export async function wary_dog(mtmp, was_dead) {
    let edog;
    const quietly = was_dead;

    await finish_meating_shared(mtmp);

    if (!mtmp.mtame)
        return;
    edog = !mtmp.isminion ? mtmp.edog : null;

    /* if monster was starving when it died, undo that now */
    if (edog && edog.mhpmax_penalty) {
        mtmp.mhpmax += edog.mhpmax_penalty;
        mtmp.mhp += edog.mhpmax_penalty; /* heal it */
        edog.mhpmax_penalty = 0;
    }

    const { pline } = await import('./display.js');
    if (edog && (edog.killed_by_u === 1 || edog.abuse > 2)) {
        mtmp.mpeaceful = mtmp.mtame = 0;
        if (edog.abuse >= 0 && edog.abuse < 10)
            if (!rn2(edog.abuse + 1))
                mtmp.mpeaceful = 1;
        if (!quietly && await cansee_shared(mtmp.mx, mtmp.my)) {
            /* C ref: mondata.h haseyes(ptr) = !(mflags1 & M1_NOEYES).  There is
               no exported haseyes() in js/ (module-private copies at
               js/monmove.js:232, js/dokick.js:740, js/polyself.js:138). */
            const { mflags1_of, M1_NOEYES } = await import('./monflags_data.js');
            const haseyes = (p) => (mflags1_of(p) & M1_NOEYES) === 0;
            if (haseyes(game.youmonst?.data)) {
                if (haseyes(mtmp.data)) {
                    const { body_part } = await import('./invent.js');
                    await pline(`${await Monnam_shared(mtmp)} `
                        + `${mtmp.mpeaceful ? 'seems unable' : 'refuses'}`
                        + ` to look you in the ${body_part(1 /*EYE*/)}.`);
                } else {
                    await pline(`${await Monnam_shared(mtmp)} avoids your gaze.`);
                }
            }
        }
    } else {
        /* chance it goes wild anyway - Pet Sematary */
        mtmp.mtame = rn2(mtmp.mtame + 1);
        if (!mtmp.mtame)
            mtmp.mpeaceful = rn2(2);
    }

    if (!mtmp.mtame) {
        if (!quietly && await canspotmon_shared(mtmp))
            await pline(`${await Monnam_shared(mtmp)} `
                + `${mtmp.mpeaceful ? 'is no longer tame'
                                    : 'has become feral'}.`);
        const { newsym } = await import('./display.js');
        newsym(mtmp.mx, mtmp.my);
        /* a life-saved monster might be leashed; don't leave it that way */
        if (mtmp.mleashed) {
            const { m_unleash } = await import('./apply.js');
            await m_unleash(mtmp, true);
        }
        if (mtmp === game.u?.usteed)
            await dismount_steed_shared(DISMOUNT_THROWN);
    } else if (edog) {
        /* it's still a pet; start a clean pet-slate now */
        edog.revivals++;
        edog.killed_by_u = 0;
        edog.abuse = 0;
        edog.ogoal.x = edog.ogoal.y = -1;
        if (was_dead || edog.hungrytime < game.moves + 500)
            edog.hungrytime = game.moves + 500;
        if (was_dead) {
            edog.droptime = 0;
            edog.dropdist = 10000;
            edog.whistletime = 0;
            edog.apport = 5;
        } /* else lifesaved, so retain current values */
    }
}

async function cansee_shared(x, y) {
    const { cansee } = await import('./vision.js');
    return cansee(x, y);
}
async function canspotmon_shared(mtmp) {
    const { canspotmon } = await import('./uhitm.js');
    return canspotmon(mtmp);
}

// rn1 is not imported at the top of this module (see the ESM-order note in the
// banner).  C ref: hacklib.c rn1(x, y) == rn2(x) + y.
function rn1(x, y) { return rn2(x) + y; }
