// region.js — C ref: src/region.c — the NhRegion subsystem (gas clouds).
//
// SCOPE: only the gas-cloud region type (INSIDE_GAS_CLOUD / EXPIRE_GAS_CLOUD)
// is WIRED UP.  region.c also supports "force fields" (create_force_field) and
// generic message/callback regions (create_msg_region); nothing in the
// covered sessions ever creates one (they are used by a handful of special
// levels and the Vlad's tower slow-force-field trap, neither reachable here).
// Those, plus save/restore (save_regions/rest_regions), the monster-membership
// helpers (add_mon_to_reg/remove_mon_from_reg/...) and the wizard-mode #timeout
// / prayer danger helpers (region_danger/region_safety) are now ported at the
// bottom of this file but are INERT: no function above calls them and no
// existing call site was rewired.
//
// The region list is a flat array on `game.regions`.  do.js goto_level() plays
// save_regions()/rest_regions(): it stashes the list on the departing level's
// store, calls clear_regions(), and on a return visit restores it with the
// ttl aged by the turns spent away.

import { game } from './gstate.js';
import { rn2, rn1, rnd } from './rng.js';
import { isok, ACCESSIBLE, IS_POOL, IS_LAVA, COLNO, ROWNO, NHF_BONESFILE } from './const.js';
import { cansee, block_point, unblock_point, does_block, Blind } from './vision.js';
// js/monflags_data.js is a generated LEAF module (no imports of its own), so
// naming it here cannot create an import cycle or a TDZ edge.
import { is_undead_flag, mflags1_of, M1_BREATHLESS } from './monflags_data.js';

const MAX_CLOUD_SIZE = 150;

// callback tags (C ref: region.c callbacks[] — INSIDE_GAS_CLOUD / EXPIRE_GAS_CLOUD)
const INSIDE_GAS_CLOUD = 'gas';
const EXPIRE_GAS_CLOUD = 'gas';

function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }

function regions() {
    if (!game.regions) game.regions = [];
    return game.regions;
}

// ── NhRegion construction ────────────────────────────────────────────────

// C ref: region.c create_region(rects, nrect) — allocate an inactive region.
// Bounding box starts as the C "empty" sentinel (lx=COLNO, ly=ROWNO, hx=hy=0)
// so the first add_rect_to_reg() widens it exactly like C's nrect>0 branch
// (which starts from rects[0] then widens with the rest) — min/max widening
// from the inverted sentinel produces the identical final box either way.
export function create_region(rects) {
    const reg = {
        rects: [],
        boundingBox: { lx: COLNO, ly: ROWNO, hx: 0, hy: 0 },
        attach2u: false,
        attach2m: null,
        enterMsg: null,
        leaveMsg: null,
        ttl: -1,
        expireF: null,
        canEnterF: null,
        enterF: null,
        canLeaveF: null,
        leaveF: null,
        insideF: null,
        heroInside: false,
        herosFault: true,
        monsters: [], // monster object refs (C keeps m_id; we keep refs directly)
        visible: false,
        glyph: null,
        arg: 0, // C's `anything arg` — for gas clouds this is the damage int
    };
    if (rects) for (const r of rects) add_rect_to_reg(reg, r);
    return reg;
}

// C ref: region.c add_rect_to_reg(reg, rect) — append a rectangle, widening
// the bounding box.
export function add_rect_to_reg(reg, rect) {
    reg.rects.push({ ...rect });
    const b = reg.boundingBox;
    if (b.lx > rect.lx) b.lx = rect.lx;
    if (b.ly > rect.ly) b.ly = rect.ly;
    if (b.hx < rect.hx) b.hx = rect.hx;
    if (b.hy < rect.hy) b.hy = rect.hy;
}

// C ref: region.c inside_rect/inside_region — point-in-region test.
function inside_rect(r, x, y) {
    return x >= r.lx && x <= r.hx && y >= r.ly && y <= r.hy;
}
export function inside_region(reg, x, y) {
    if (!reg) return false;
    if (!inside_rect(reg.boundingBox, x, y)) return false;
    return reg.rects.some((r) => inside_rect(r, x, y));
}

// C ref: region.c add_region(reg) — activate a region: register it, sweep its
// bounding box for monsters/hero already inside it, and (if visible) block
// line of sight through every covered cell and redraw it.
export async function add_region(reg) {
    regions().push(reg);
    const b = reg.boundingBox;
    const { newsym } = await import('./display.js');
    for (let x = b.lx; x <= b.hx; x++) {
        for (let y = b.ly; y <= b.hy; y++) {
            if (!isok(x, y)) continue;
            const isInside = inside_region(reg, x, y);
            if (isInside) {
                const mtmp = (game.level?.monsters || []).find((m) => !m.mridden && m.mx === x && m.my === y);
                if (mtmp && !reg.monsters.includes(mtmp)) reg.monsters.push(mtmp);
            }
            if (reg.visible) {
                if (isInside) block_point(x, y);
                if (cansee(x, y)) newsym(x, y);
            }
        }
    }
    reg.heroInside = inside_region(reg, game.u?.ux, game.u?.uy);
}

// C ref: region.c remove_region(reg) — deactivate + free.  A visible region's
// footprint is unblocked in a first pass, then (unless Blind) redrawn in a
// second pass once every cell in the box has had a chance to unblock (matches
// C's two-pass comment: don't call cansee() until all blocked spots are down).
export async function remove_region(reg) {
    const list = regions();
    const i = list.indexOf(reg);
    if (i < 0) return;
    list.splice(i, 1);
    reg.ttl = -2; // C ref: region.c — sentinel for visible_region_at() below

    if (reg.visible) {
        const b = reg.boundingBox;
        const { newsym } = await import('./display.js');
        const passes = Blind() ? 1 : 2;
        for (let pass = 1; pass <= passes; pass++) {
            for (let x = b.lx; x <= b.hx; x++) {
                for (let y = b.ly; y <= b.hy; y++) {
                    if (!isok(x, y) || !inside_region(reg, x, y)) continue;
                    if (pass === 1) {
                        if (!does_block(x, y)) unblock_point(x, y);
                    } else if (cansee(x, y)) {
                        newsym(x, y);
                    }
                }
            }
        }
    }
}

// C ref: region.c clear_regions() — wipe every region (mklev's
// clear_level_structures, and save_regions()'s release_data arm).
export function clear_regions() {
    game.regions = [];
}

// ── per-turn processing ──────────────────────────────────────────────────

// C ref: region.c run_regions() — called once per game turn.  Expires dead
// regions, ages the rest, and fires each visible region's inside-callback for
// the hero and every monster it currently contains.
export async function run_regions() {
    const list = regions();
    let dissWithin = false;
    let dissSeen = 0;

    // "End of life?" pass — backward, since expiry mutates the array.
    for (let i = list.length - 1; i >= 0; i--) {
        const reg = list[i];
        if (reg.ttl === 0) {
            let expired = true;
            if (reg.expireF === EXPIRE_GAS_CLOUD) expired = expire_gas_cloud(reg);
            if (expired) {
                if (reg._dissWithin) dissWithin = true;
                dissSeen += reg._dissSeen || 0;
                await remove_region(reg);
            }
        }
    }

    // Process remaining regions: age + inside-callback for hero/monsters.
    for (const reg of list) {
        if (reg.ttl > 0) reg.ttl--;
        if (reg.insideF !== INSIDE_GAS_CLOUD) continue;
        if (reg.heroInside) await inside_gas_cloud(reg, null);
        for (let j = reg.monsters.length - 1; j >= 0; j--) {
            const mtmp = reg.monsters[j];
            const dead = !mtmp || (mtmp.mhp != null && mtmp.mhp <= 0);
            const died = dead ? true : await inside_gas_cloud(reg, mtmp);
            if (died) reg.monsters.splice(j, 1);
        }
    }

    const { update_topl } = await import('./display.js');
    if (dissWithin) {
        await update_topl('The gas cloud around you dissipates.');
        if ((game.u?.xray_range ?? 0) <= 1) dissSeen = 0;
    }
    if (dissSeen) {
        await update_topl(`You see ${dissSeen === 1 ? 'a' : 'some'} gas cloud${dissSeen === 1 ? '' : 's'} dissipate.`);
    }
}

// C ref: region.c reg_damg(reg) — per-turn damage a visible, non-removed
// region deals.  Unused by any covered session; kept for parity.
export function reg_damg(reg) {
    return (!reg.visible || reg.ttl === -2) ? 0 : reg.arg;
}

// C ref: region.c any_visible_region() — any live, visible region on the level.
export function any_visible_region() {
    return regions().some((r) => r.visible && r.ttl !== -2);
}

// C ref: region.c visible_region_at(x,y) — the visible region (if any)
// covering <x,y>.
export function visible_region_at(x, y) {
    for (const r of regions()) {
        if (!r.visible || r.ttl === -2) continue;
        if (inside_region(r, x, y)) return r;
    }
    return null;
}

// C ref: region.c show_region(reg,x,y) — the glyph a visible region draws.
export function show_region(reg) {
    return reg.glyph;
}

// C ref: region.c is_hero_inside_gas_cloud() (staticfn) — true if the hero is
// currently inside a live gas-cloud region.
function is_hero_inside_gas_cloud() {
    return regions().some((r) => r.heroInside && r.insideF === INSIDE_GAS_CLOUD);
}

// ── movement-triggered enter/leave bookkeeping ──────────────────────────
// C ref: region.c in_out_region()/m_in_out_region() — called when the hero or
// a monster moves, to update heroInside/monsters membership (and fire
// enter_msg/leave_msg + enter_f/leave_f callbacks, unused by gas clouds).
// NOT currently called from hack.js's domove() or monmove.js's move-commit
// path (see file header); every region a covered session creates so far sits
// on its generator's own square and is refreshed there each turn by
// inside_gas_cloud's ttl bump, so the gap has not been exercised.  Exported so
// that hook can be added later without touching this module again.
export function in_out_region(x, y) {
    for (const reg of regions()) {
        if (reg.attach2u) continue;
        if (reg.heroInside && !inside_region(reg, x, y)) reg.heroInside = false;
    }
    for (const reg of regions()) {
        if (reg.attach2u) continue;
        if (!reg.heroInside && inside_region(reg, x, y)) reg.heroInside = true;
    }
}
export function m_in_out_region(mon, x, y) {
    for (const reg of regions()) {
        if (reg.attach2m === mon) continue;
        if (reg.monsters.includes(mon) && !inside_region(reg, x, y)) {
            const idx = reg.monsters.indexOf(mon);
            if (idx >= 0) reg.monsters.splice(idx, 1);
        }
    }
    for (const reg of regions()) {
        if (reg.attach2m === mon) continue;
        if (!reg.monsters.includes(mon) && inside_region(reg, x, y)) reg.monsters.push(mon);
    }
}

// C ref: region.c update_player_regions()/update_monster_region(mon) — resync
// membership after a teleport.  Not wired into teleport.js (no covered
// session teleports while a region exists); exported for parity/future use.
export function update_player_regions() {
    const ux = game.u?.ux, uy = game.u?.uy;
    for (const reg of regions()) reg.heroInside = !reg.attach2u && inside_region(reg, ux, uy);
}
export function update_monster_region(mon) {
    for (const reg of regions()) {
        const inside = inside_region(reg, mon.mx, mon.my);
        const has = reg.monsters.includes(mon);
        if (inside && !has) reg.monsters.push(mon);
        else if (!inside && has) reg.monsters.splice(reg.monsters.indexOf(mon), 1);
    }
}

// ── gas clouds ───────────────────────────────────────────────────────────

// C ref: read.c valid_cloud_pos(x,y) — can a cloud square physically exist
// there (in bounds, and floor/door/pool/lava — not rock/wall).
function valid_cloud_pos(x, y) {
    if (!isok(x, y)) return false;
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return ACCESSIBLE(loc.typ) || IS_POOL(loc.typ) || IS_LAVA(loc.typ);
}

// C ref: mondata.h nonliving/breathless — simplified to a name-based check
// over the small set of monster types the contest's covered sessions can put
// inside a gas cloud; mirrors mhitm.js's identical simplification.
function nonliving_name(name) {
    return /\bzombie\b|\bmummy\b|\bskeleton\b|\bwraith\b|\bghost\b|\blich\b|golem\b|\bvortex\b|\belemental\b|\bshade\b/.test(name || '');
}
function breathless_name(name) {
    return /\bjelly\b|\bpudding\b|\bslime\b|\bgolem\b|\bvortex\b|\belemental\b|\bgas spore\b/.test(name || '');
}

// C ref: mon.c m_poisongas_ok(mtmp) — M_POISONGAS_OK(2)/MINOR(1)/BAD(0).
// SCOPE: the swimmer/eel-in-water and breath-weapon exclusions, and hero/
// monster poison-resistance lookups, are not modeled by any other subsystem
// yet, so a living, breathing target always falls through to BAD — true for
// every monster the covered sessions can put inside a (so far always
// damage-0) gas cloud.
const M_POISONGAS_BAD = 0;
const M_POISONGAS_OK = 2;
function m_poisongas_ok(mtmp, isHero) {
    const data = isHero ? game.u?.data : mtmp?.data;
    const name = data?.name || '';
    if (nonliving_name(name) || breathless_name(name)) return M_POISONGAS_OK;
    return M_POISONGAS_BAD;
}

// C ref: hack.c losehp() — for a non-polymorphed hero this is just HP
// arithmetic (death handling is not exercised by any covered session that
// reaches this code path yet); mirrors the same simplification other files
// (fountain.js, trap.js, ...) already apply to losehp().
function loseHeroHp(n) {
    const u = game.u;
    if (!u) return;
    u.uhp -= n;
    if (u.uhp < 1) u.uhp = 0;
}

// C ref: region.c make_gas_cloud(cloud, damage, inside_cloud) — shared tail of
// create_gas_cloud()/create_gas_cloud_selection(): mark the region as heros_
// fault (unless a monster's move or level generation triggered it), set its
// display glyph, activate it, and announce "enveloped in gas/steam" unless
// the hero was already inside a cloud before this one was created.
async function make_gas_cloud(cloud, damage, insideCloud) {
    cloud.herosFault = !game._in_mklev && !game.context?.mon_moving;
    cloud.insideF = INSIDE_GAS_CLOUD;
    cloud.expireF = EXPIRE_GAS_CLOUD;
    cloud.arg = damage;
    cloud.visible = true;
    cloud.glyph = damage
        ? { ch: '#', color: 10 /* CLR_BRIGHT_GREEN, S_poisoncloud */ }
        : { ch: '#', color: 7 /* CLR_GRAY, S_cloud */ };
    await add_region(cloud);

    if (!game._in_mklev && !insideCloud && is_hero_inside_gas_cloud()) {
        const { update_topl } = await import('./display.js');
        await update_topl(`You are enveloped in a cloud of ${damage ? 'noxious gas' : 'steam'}!`);
    }
}

// C ref: region.c add_region() minus the newsym() refresh.  Level generation
// (des.gas_cloud) activates regions from the synchronous themeroom_fill path,
// which cannot await display.js — and mklev draws nothing anyway, the map is
// rendered from scratch once generation finishes.  Kept separate from
// add_region() rather than shared, because C interleaves block_point() and
// newsym() cell by cell and reordering them would change what the gameplay
// path redraws.
function add_region_nodisplay(reg) {
    regions().push(reg);
    const b = reg.boundingBox;
    for (let x = b.lx; x <= b.hx; x++) {
        for (let y = b.ly; y <= b.hy; y++) {
            if (!isok(x, y)) continue;
            if (!inside_region(reg, x, y)) continue;
            const mtmp = (game.level?.monsters || []).find((m) => !m.mridden && m.mx === x && m.my === y);
            if (mtmp && !reg.monsters.includes(mtmp)) reg.monsters.push(mtmp);
            if (reg.visible) block_point(x, y);
        }
    }
    reg.heroInside = inside_region(reg, game.u?.ux, game.u?.uy);
}

// C ref: region.c create_gas_cloud_selection(sel, damage) — des.gas_cloud()'s
// selection form: one region whose rects are the selection's cells, each 1x1.
// Draws NO RNG (no BFS growth, no rn1(3,4) ttl), so the region keeps
// create_region's permanent ttl of -1.
export function create_gas_cloud_selection(sel, damage) {
    const cloud = create_region(null);
    for (const c of sel)
        add_rect_to_reg(cloud, { lx: c.x, ly: c.y, hx: c.x, hy: c.y });
    // make_gas_cloud() tail; the "enveloped in steam" line is gated on
    // !in_mklev, and this form is only reachable from mklev.
    cloud.herosFault = !game._in_mklev && !game.context?.mon_moving;
    cloud.insideF = INSIDE_GAS_CLOUD;
    cloud.expireF = EXPIRE_GAS_CLOUD;
    cloud.arg = damage;
    cloud.visible = true;
    cloud.glyph = damage
        ? { ch: '#', color: 10 /* CLR_BRIGHT_GREEN, S_poisoncloud */ }
        : { ch: '#', color: 7 /* CLR_GRAY, S_cloud */ };
    add_region_nodisplay(cloud);
    return cloud;
}

// C ref: region.c create_gas_cloud(x,y,cloudsize,damage) — grow a cloud from
// (x,y) via a randomized breadth-first search, then give it a lifespan.
export async function create_gas_cloud(x, y, cloudsize, damage) {
    const xcoords = [x], ycoords = [y];
    let newidx = 1;
    let insideCloud = is_hero_inside_gas_cloud();

    // C ref: region.c — a single-point cloud landing on the hero that deals no
    // damage (or the hero is poison-gas-immune) is silent: presumably a side
    // effect of a benign polyform, not worth a message.
    if (!game.context?.mon_moving && u_at(x, y) && cloudsize === 1
        && (!damage || m_poisongas_ok(null, true) === M_POISONGAS_OK))
        insideCloud = true;

    if (cloudsize > MAX_CLOUD_SIZE) cloudsize = MAX_CLOUD_SIZE;

    for (let curridx = 0; curridx < newidx; curridx++) {
        if (newidx >= cloudsize) break;
        const xx = xcoords[curridx], yy = ycoords[curridx];

        // C ref: region.c — Fisher-Yates-Knuth shuffle of the 4 cardinal dirs.
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (let i = 4; i > 0; i--) {
            const swapidx = rn2(i);
            const tmp = dirs[swapidx];
            dirs[swapidx] = dirs[i - 1];
            dirs[i - 1] = tmp;
        }

        let nvalid = 0;
        // C ref: region.c — the "stop once cloudsize is reached" check is a
        // SIBLING of the `if (valid_cloud_pos)` block below, not a loop-top
        // guard: a `continue` taken from inside that block (the disruption
        // roll) skips the check for this iteration entirely, exactly like C's
        // `continue` jumps straight to `i++` past the trailing `if`.  Mirror
        // that placement literally rather than hoisting it, since it changes
        // how many disruption rn2(2) rolls a cloudsize>1 cloud consumes.
        for (let i = 0; i < 4; i++) {
            const dx = dirs[i][0], dy = dirs[i][1];
            let isunpicked = true;
            if (valid_cloud_pos(xx + dx, yy + dy)) {
                nvalid++;
                for (let j = 0; j < newidx; j++) {
                    if (xcoords[j] === xx + dx && ycoords[j] === yy + dy) { isunpicked = false; break; }
                }
                // C ref: region.c — randomly skip a 4-valid-neighbor square so
                // the cloud doesn't grow into a perfect rhombus in open rooms.
                if (nvalid === 4 && !rn2(2)) continue;
                if (isunpicked) {
                    xcoords[newidx] = xx + dx;
                    ycoords[newidx] = yy + dy;
                    newidx++;
                }
            }
            if (newidx >= cloudsize) break;
        }
    }

    const cloud = create_region(null);
    for (let i = 0; i < newidx; i++) {
        add_rect_to_reg(cloud, { lx: xcoords[i], ly: ycoords[i], hx: xcoords[i], hy: ycoords[i] });
    }
    cloud.ttl = rn1(3, 4);
    // C ref: region.c — a cloud that was space-constrained (couldn't grow to
    // its full requested size) lives proportionally longer.
    cloud.ttl = Math.trunc((cloud.ttl * cloudsize) / newidx);

    await make_gas_cloud(cloud, damage, insideCloud);
    return cloud;
}

// C ref: region.c expire_gas_cloud(reg) — the region's EXPIRE_GAS_CLOUD
// callback, run by run_regions() once ttl hits 0.  A "thick" (damage >= 5)
// cloud dissipates by half and gets a fresh short lease instead of vanishing
// outright; anything thinner really goes away (unblocking its footprint).
// Stashes the within/seen dissipation tally on the region for run_regions()
// to fold into its single end-of-turn message (matching C's file-scope
// gas_cloud_diss_within/gas_cloud_diss_seen accumulators).
function expire_gas_cloud(reg) {
    const damage = reg.arg;
    if (damage >= 5) {
        reg.arg = Math.trunc(damage / 2);
        reg.ttl = 2;
        return false; // still there
    }

    const b = reg.boundingBox;
    reg._dissWithin = false;
    reg._dissSeen = 0;
    const passes = Blind() ? 1 : 2;
    for (let pass = 1; pass <= passes; pass++) {
        for (let x = b.lx; x <= b.hx; x++) {
            for (let y = b.ly; y <= b.hy; y++) {
                if (!isok(x, y) || !inside_region(reg, x, y)) continue;
                if (pass === 1) {
                    if (!does_block(x, y)) unblock_point(x, y);
                } else if (!game.u?.uswallow) {
                    if (u_at(x, y)) reg._dissWithin = true;
                    else if (cansee(x, y)) reg._dissSeen++;
                }
            }
        }
    }
    return true; // gone, free it
}

// C ref: region.c inside_gas_cloud(reg, mtmp) — per-turn effect on whoever is
// standing in a gas-cloud region; mtmp null means the hero.  Returns true if
// the callback's subject died (run_regions() uses that to drop it from the
// region's monster list, matching C's boolean return).
async function inside_gas_cloud(reg, mtmp) {
    const isHero = !mtmp;
    const data = isHero ? game.u?.data : mtmp?.data;
    const name = data?.name || '';

    // C ref: region.c — fog clouds maintain their own gas clouds indefinitely
    // (this is what makes a hero-as-fog-cloud's trailing vapor near-permanent
    // while they stand still): bump the ttl by 5 every turn it's below 20.
    if (reg.ttl < 20 && name === 'fog cloud') reg.ttl += 5;

    const dam = reg.arg;
    if (dam < 1) return false; // harmless vapor: nothing else to do

    const { update_topl } = await import('./display.js');
    if (isHero) {
        if (m_poisongas_ok(null, true) === M_POISONGAS_OK) return false;
        if (!Blind()) {
            await update_topl('Your eyes sting.');
            // C ref: region.c make_blinded(1L, FALSE) — a 1-turn blindness
            // timer.  No blindness-timer subsystem exists yet in this port
            // (see m_poisongas_ok's SCOPE note); the message still fires so
            // the RNG-inert observable text matches, but the timer itself is
            // not modeled.
        }
        // C ref: region.c — Poison_resistance is never true for the covered
        // heroes yet (see m_poisongas_ok SCOPE note), so this always takes
        // the damaging branch.
        await update_topl('Something is burning your lungs!');
        await update_topl('You cough and spit blood!');
        const dmg = rnd(dam) + 5;
        loseHeroHp(dmg);
        return false;
    }
    // SCOPE: monster-in-poison-cloud damage/death is not modeled (no covered
    // session has a non-hero monster standing in a damaging cloud yet); the
    // ttl refresh above (the only effect a damage-0 cloud can have) is
    // faithful for every case reached so far.
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// The rest of src/region.c.  INERT: nothing above this line calls into it and
// no existing call site was rewired.  Everything here works over the same flat
// `game.regions` array and the same region record create_region() builds, with
// one representation difference carried over from that record: C's
// reg->monsters is an array of m_id with an explicit n_monst/max_monst pair,
// while ours is a JS array of monster OBJECT REFS.  Where a C function only
// exists to manage that array's capacity (add_mon_to_reg's realloc) the growth
// bookkeeping is dropped; where the array's ORDER is observable
// (remove_mon_from_reg's swap-with-last, which run_regions() then walks) it is
// reproduced exactly.
// ─────────────────────────────────────────────────────────────────────────────

// C ref: include/defsym.h MONSYMS — the numeric class indices used below.
// NOTE mons[].mlet is the display CHARACTER in this port (js/makemon.js:621);
// the numeric S_* class index is `.mcls` (:620), so every C `ptr->mlet == S_FOO`
// is written `ptr.mcls === S_FOO` here.
const S_VORTEX = 22, S_GOLEM = 55;

// C ref: region.c:210 mon_in_region(reg, mon) — "It's probably quicker to check
// with the region internal list than to check for coordinates."
export function mon_in_region(reg, mon) {
    if (!reg || !mon) return false;
    for (let i = 0; i < reg.monsters.length; i++)
        if (reg.monsters[i] === mon)
            return true;
    return false;
}

// C ref: region.c:161 add_mon_to_reg(reg, mon) — append a monster.  A long worm
// occupies several squares of the region, so it can already be present; C
// impossible()s for anything else and returns either way.  The impossible() is
// omitted rather than reached through a dynamic import of display.js (which is
// a static-import cycle with this module); the early return IS the behaviour.
export function add_mon_to_reg(reg, mon) {
    if (!reg || !mon) return;
    /* if this is a long worm, it might already be present in the region;
       only include it once no matter how many segments the region contains */
    if (mon_in_region(reg, mon))
        return;
    /* C grows reg->monsters by MONST_INC here; a JS array grows itself */
    reg.monsters.push(mon);
}

// C ref: region.c:192 remove_mon_from_reg(reg, mon) — it left or died.  The
// removal is a SWAP WITH THE LAST ELEMENT, not a splice: C moves
// monsters[n_monst-1] into the freed slot.  run_regions() walks the list, so
// preserving that reorder matters (js/region.js's own m_in_out_region() uses
// splice, which is the C behaviour of a different function).
export function remove_mon_from_reg(reg, mon) {
    if (!reg || !mon) return;
    for (let i = 0; i < reg.monsters.length; i++)
        if (reg.monsters[i] === mon) {
            const last = reg.monsters.length - 1;
            reg.monsters[i] = reg.monsters[last];
            reg.monsters.length = last;
            return;
        }
}

// C ref: region.c:622 replace_mon_regions(monold, monnew) — a monster that grew
// needs a new struct, so swap the identity in every region holding the old one.
// (C has this under `#if 0`; ported for completeness.)
export function replace_mon_regions(monold, monnew) {
    const list = regions();
    for (let i = 0; i < list.length; i++)
        if (mon_in_region(list[i], monold)) {
            remove_mon_from_reg(list[i], monold);
            add_mon_to_reg(list[i], monnew);
        }
}

// C ref: region.c:638 remove_mon_from_regions(mon) — the monster just died.
export function remove_mon_from_regions(mon) {
    const list = regions();
    for (let i = 0; i < list.length; i++)
        if (mon_in_region(list[i], mon))
            remove_mon_from_reg(list[i], mon);
}

// C ref: region.c:227 clone_region(reg) — a standalone copy (C `#if 0`, "not yet
// used").  C's create_region(reg->rects, reg->nrects) rebuilds the bounding box
// from the copied rects, so this goes through create_region() too rather than
// copying boundingBox directly.
export function clone_region(reg) {
    const ret_reg = create_region(reg.rects);

    ret_reg.ttl = reg.ttl;
    ret_reg.attach2u = reg.attach2u;
    ret_reg.attach2m = reg.attach2m;
    /* ret_reg->attach_2_o = reg->attach_2_o; */
    ret_reg.expireF = reg.expireF;
    ret_reg.enterF = reg.enterF;
    ret_reg.canEnterF = reg.canEnterF;
    ret_reg.leaveF = reg.leaveF;
    ret_reg.canLeaveF = reg.canLeaveF;
    /* C copies player_flags as one word; this port splits it into the two
       named bits set_hero_inside()/set_heros_fault() poke */
    ret_reg.heroInside = reg.heroInside;
    ret_reg.herosFault = reg.herosFault;
    ret_reg.monsters = reg.monsters.slice();
    /* fields C's clone_region does NOT copy, so neither do we: enter_msg,
       leave_msg, inside_f, visible, glyph, arg */
    return ret_reg;
}

// C ref: region.c:263 free_region(reg) — release the region and everything
// hanging off it.  JS is garbage collected, so the faithful part is dropping
// the references C frees (rects, monsters, enter_msg, leave_msg) rather than
// the free() calls themselves; a region still on game.regions would otherwise
// keep its whole monster list alive.
export function free_region(reg) {
    if (reg) {
        if (reg.rects) reg.rects = null;
        if (reg.monsters) reg.monsters = null;
        if (reg.enterMsg) reg.enterMsg = null;
        if (reg.leaveMsg) reg.leaveMsg = null;
    }
}

// C ref: region.c:674 visible_region_summary(win) — the wizard-mode #timeout
// listing.  js/timeout.js:1866 stubs this as _visible_region_summary(); the
// window convention in this port is a `{ type, lines: [] }` record whose lines
// the wiring pass renders (js/timeout.js:1863 _putstr, js/end.js:1375), so
// putstr() is that push.
export function visible_region_summary(win) {
    const putstr = (w, _attr, s) => { if (w) (w.lines = w.lines || []).push(String(s ?? '')); };
    const fldsep = game.iflags?.menu_tab_sep ? '\t' : '  ';
    const list = regions();
    let hdr_done = 0;

    for (let i = 0; i < list.length; i++) {
        const reg = list[i];
        if (!reg.visible || reg.ttl === -2)
            continue;

        if (!hdr_done++) {
            putstr(win, 0, '');
            putstr(win, 0, 'Visible regions');
        }
        /* we display relative time (turns left) rather than absolute; since
           time-to-live has already been decremented, regions due to time out
           on the next turn have ttl==0, so add 1 to be less confusing */
        let buf = String(reg.ttl + 1).padStart(5, ' ');
        const damg = reg.arg | 0;
        const typbuf = damg ? `poison gas (${damg})` : 'vapor';
        buf += `${fldsep}${typbuf.padEnd(16, ' ')}`;
        const b = reg.boundingBox;
        buf += `${fldsep}@[${b.lx},${b.ly}..${b.hx},${b.hy}]`;
        putstr(win, 0, buf);
    }
}

// C ref: region.c:899 region_stats(hdrfmt, hdrbuf, &count, &size) — the
// wizard-mode #stats row.  It is the one stats formatter that takes TWO %ld
// arguments (sizeof NhRegion and sizeof NhRect), which js/wizcmds.js:1608
// already documents; the return shape matches that file's nyi_*_stats()
// convention ({ hdrbuf, count, size }) since C's out-params have no JS analogue.
// C ref: region.h sizeof(NhRegion) / sizeof(NhRect) — the same two values
// js/wizcmds.js:189 already uses for this row, so the #stats header matches.
const SIZEOF_NHREGION = 96, SIZEOF_NHRECT = 8;
export function region_stats(hdrfmt) {
    const list = regions();
    /* other stats formats take one parameter; this takes two */
    const hdrbuf = String(hdrfmt ?? '')
        .replace('%ld', String(SIZEOF_NHREGION))
        .replace('%ld', String(SIZEOF_NHRECT));
    const count = list.length; /* might be 0 even tho max_regions isn't */
    let size = (game.max_regions | 0) * SIZEOF_NHREGION;

    for (let i = 0; i < list.length; ++i) {
        const rg = list[i];
        size += (rg.rects?.length | 0) * SIZEOF_NHRECT;
        if (rg.enterMsg) size += rg.enterMsg.length + 1;
        if (rg.leaveMsg) size += rg.leaveMsg.length + 1;
        /* C uses max_monst * sizeof *rg->monsters (unsigned m_id); a JS array
           has no separate capacity, so n_monst stands in for max_monst */
        size += (rg.monsters?.length | 0) * 4;
    }
    return { hdrbuf, count, size };
}

// C ref: restore.c lookup_id_mapping(gid, nid) — the bones-file id remap.
// js/light.js:959 keeps the same private reader over game.id_map; this port
// never loads another game's bones, so the map is empty and every lookup fails.
function lookup_id_mapping(gid) {
    const map = game.id_map;
    if (!map) return null;
    const nid = map.get ? map.get(gid) : map[gid];
    return nid == null ? null : nid;
}

// C ref: region.c:928 reset_region_mids(reg) — remap a bones region's monster
// ids onto the ids the restore just handed out, dropping the ones that did not
// survive.  This is the ONE place the m_id representation is observable, so it
// operates on the id form rest_regions() reads out of a save; a live region's
// reg.monsters holds object refs and is left alone (an object is never a
// lookup_id_mapping key).  Removal is swap-with-last: "order doesn't matter".
export function reset_region_mids(reg) {
    const mid_list = reg.monsters;
    let i = 0, n = mid_list.length;

    while (i < n) {
        if (typeof mid_list[i] !== 'number') { ++i; continue; }
        const nid = lookup_id_mapping(mid_list[i]);
        if (nid == null) {
            /* shrink list to remove missing monster; order doesn't matter */
            mid_list[i] = mid_list[--n];
        } else {
            mid_list[i] = nid;
            /* move on to next monster */
            ++i;
        }
    }
    mid_list.length = n;
}

// C ref: region.c:741 save_regions(nhfp) / :799 rest_regions(nhfp).
// SCOPE: js/storage.js is frozen and this port's save format is its own, so the
// per-field Sfo_*/Sfi_* marshalling has no analogue; what these two carry is
// the LOGIC that is not marshalling — the moves timestamp, the release_data()
// clear_regions(), the ttl aging on the way back in, the removal of regions
// that expired while the hero was away, and the bones monster-id remap.
// js/do.js:913 (stash) and js/do.js:1434 (restore + aging) inline exactly this
// for the level-change path; these are region.c's own symbols for it.
export function save_regions(nhfp) {
    const list = regions();
    if (!nhfp) return;
    if (update_file(nhfp)) {
        /* timestamp */
        nhfp.regionTimestamp = game.moves | 0;
        nhfp.n_regions = list.length;
        /* the region records themselves; C writes bounding_box, nrects, each
           rect, attach_2_u, attach_2_m, enter/leave msg, ttl, the six callback
           indices, player_flags, the m_id list, visible, glyph and arg -- our
           record already holds each of those under its own name */
        nhfp.regions = list;
    }
    if (release_data(nhfp))
        clear_regions();
}
// C ref: sfstruct.h update_file(nhfp) / release_data(nhfp) — a save writes the
// data and (for a real save, not a checkpoint) then frees it.
function update_file(nhfp) { return nhfp.update_file !== false; }
function release_data(nhfp) { return nhfp.release_data === true; }

export function rest_regions(nhfp) {
    const ghostly = (nhfp?.ftype === NHF_BONESFILE);
    let tmstamp = nhfp?.regionTimestamp | 0;

    clear_regions(); /* Just for security */
    if (ghostly)
        tmstamp = 0;
    else
        tmstamp = (game.moves | 0) - tmstamp;

    const saved = nhfp?.regions || [];
    game.regions = saved.slice();
    game.max_regions = game.regions.length;
    for (const r of game.regions) {
        /* check for expired region */
        if (r.ttl >= 0)
            r.ttl = (r.ttl > tmstamp) ? r.ttl - tmstamp : 0;
        if (ghostly) { /* settings pertained to old player */
            r.heroInside = false; /* clear_hero_inside(r) */
            r.herosFault = false; /* clear_heros_fault(r) */
        }
    }

    /* remove expired regions, do not trigger the expire_f callback (yet!);
       also update monster lists if this data is coming from a bones file.
       C walks BACKWARD because remove_region() compacts the array. */
    const out = [];
    for (let i = game.regions.length - 1; i >= 0; i--) {
        const r = game.regions[i];
        if (r.ttl === 0)
            out.push(r);
        else if (ghostly && r.monsters?.length > 0)
            reset_region_mids(r);
    }
    return out; /* callers await remove_region() on these; see note below */
}
// NOTE: rest_regions() cannot call remove_region() itself here — this port's
// remove_region() is async (it awaits display.js for the newsym() refresh), and
// C's rest_regions() is a void sync function whose callers are not.  The
// expired regions are returned instead so a caller can `for (const r of
// rest_regions(nhfp)) await remove_region(r);`.

// C ref: region.c:955 create_msg_region(x, y, w, h, msg_enter, msg_leave) — a
// permanent (ttl -1) region that only prints on entry/exit.  C `#if 0`, "not
// yet used"; note the rect is x..x+w / y..y+h, so w/h are INCLUSIVE offsets and
// a 0x0 region still covers one square.
export function create_msg_region(x, y, w, h, msg_enter, msg_leave) {
    const reg = create_region(null);

    if (msg_enter) reg.enterMsg = String(msg_enter);
    if (msg_leave) reg.leaveMsg = String(msg_leave);
    add_rect_to_reg(reg, { lx: x, ly: y, hx: x + w, hy: y + h });
    reg.ttl = -1;
    return reg;
}

// C ref: region.c:983 enter_force_field(p1, p2) — the can_enter_f/can_leave_f
// callback: p2 null means the hero, otherwise it is the monster that walked
// into the field.  Always returns FALSE, i.e. entry is refused.  C `#if 0`.
export async function enter_force_field(p1, p2) {
    void p1;
    const { update_topl } = await import('./display.js');

    if (!p2) { /* That means the player */
        if (!Blind())
            await update_topl(`You bump into ${
                Hallucination() ? 'an invisible tree'
                                : 'some kind of invisible wall'}.  Ouch!`);
        else
            await update_topl('Ouch!');
    } else {
        const mtmp = p2;
        const { canspotmon, Monnam } = await import('./uhitm.js');
        /* C uses canseemon(); canspotmon() is the pair js/uhitm.js exports */
        if (canspotmon(mtmp))
            await update_topl(`${Monnam(mtmp)} bumps into something!`);
    }
    return false;
}

// C ref: region.c:1003 create_force_field(x, y, radius, ttl) — a diamond of
// `radius` nested 1-column-wide rects centred on (x,y).  C `#if 0`; the two
// can_enter_f/can_leave_f assignments are commented out THERE too, so the field
// blocks nothing until they are restored.  Draws no RNG.
export async function create_force_field(x, y, radius, ttl) {
    const ff = create_region(null);
    const nrect = radius;
    const tmprect = { lx: x, hx: x, ly: y - (radius - 1), hy: y + (radius - 1) };

    for (let i = 0; i < nrect; i++) {
        add_rect_to_reg(ff, tmprect);
        tmprect.lx--;
        tmprect.hx++;
        tmprect.ly++;
        tmprect.hy--;
    }
    ff.ttl = ttl;
    if (!game._in_mklev && !game.context?.mon_moving)
        ff.herosFault = true; /* set_heros_fault(): assume the player made it */
    /* ff->can_enter_f = enter_force_field; */
    /* ff->can_leave_f = enter_force_field; */
    await add_region(ff);
    return ff;
}

// C ref: mondata.h:219 nonliving(ptr) — is_undead || PM_MANES || is_golem ||
// mlet == S_VORTEX.  region.js's own nonliving_name() above is a NAME-REGEX
// reduction of this used by inside_gas_cloud(); this is the flag/class form.
function nonliving(ptr) {
    return is_undead_flag(ptr) || ptr?.name === 'manes'
        || ptr?.mcls === S_GOLEM || ptr?.mcls === S_VORTEX;
}
// C ref: youprop.h:276 Breathless — HMagical_breathing || EMagical_breathing ||
// breathless(gy.youmonst.data).  u.data is a bogus mons[] row while
// unpolymorphed in this port (u.umonnum is a ROLE index), and no player-monster
// form is breathless anyway, so the form half is gated on Upolyd exactly as
// C's own uses of youmonst.data are safe only because C keeps that row valid.
function Breathless() {
    const u = game.u, p = u?.uprops || {};
    if (p.HMagical_breathing || p.EMagical_breathing || p.Magical_breathing)
        return true;
    return !!u?.Upolyd && (mflags1_of(u.data) & M1_BREATHLESS) !== 0;
}
function Poison_resistance() {
    const p = game.u?.uprops || {};
    return !!(p.HPoison_resistance || p.EPoison_resistance
              || p.PoisonResistance || p.Poison_resistance);
}
function Hallucination() {
    const u = game.u;
    return !!(u?.uhallu || u?.HHallucination || u?.uprops?.Hallucination);
}

// C ref: region.c:1341 region_danger() — for checking troubles during prayer:
// is the hero standing in something that can hurt her?  js/pray.js:203 and
// js/timeout.js:497 both note this as unmodelled at their call sites.
export function region_danger() {
    const list = regions();
    let n = 0;

    for (let i = 0; i < list.length; i++) {
        /* only care about regions that hero is in */
        if (!list[i].heroInside)
            continue;
        const f_indx = list[i].insideF;
        /* the only type of region we understand is gas_cloud */
        if (f_indx === INSIDE_GAS_CLOUD) {
            /* completely harmless if you don't need to breathe */
            if ((game.u?.Upolyd && nonliving(game.u.data)) || Breathless())
                continue;
            /* minor inconvenience if you're poison resistant; not harmful
               enough to be a prayer-level trouble */
            if (Poison_resistance())
                continue;
            ++n;
        }
    }
    return n ? true : false;
}

// C ref: region.c:1368 region_safety() — prayer's "fix all troubles" arm for
// region_danger(); the danger detected at the START of the prayer may have
// expired by now.  DRAWS: the multiple-overlapping-clouds arm rolls d(4,4) for
// the granted magical-breathing timer, and safe_teleds() draws its own.
export async function region_safety() {
    const list = regions();
    let r = null, n = 0;

    for (let i = 0; i < list.length; i++) {
        /* only care about regions that hero is in */
        if (!list[i].heroInside)
            continue;
        const f_indx = list[i].insideF;
        /* the only type of region we understand is gas_cloud */
        if (f_indx === INSIDE_GAS_CLOUD) {
            if (!n++ && list[i].ttl >= 0)
                r = list[i];
        }
    }

    const { update_topl } = await import('./display.js');
    if (n > 1 || (n === 1 && !r)) {
        /* multiple overlapping cloud regions or non-expiring one */
        const { safe_teleds_hero } = await import('./read.js');
        await safe_teleds_hero();
        /* maybe there's no safe place available; must get hero out of danger
           or prayer's "fix all troubles" result will get stuck in a loop */
        if (region_danger()) {
            const p = (game.u.uprops = game.u.uprops || {});
            /* set_itimeout(&HMagical_breathing, d(4,4) + 4) */
            p.HMagical_breathing = (rnd(4) + rnd(4) + rnd(4) + rnd(4)) + 4;
            /* not already Breathless or wouldn't be in region danger */
            await update_topl('You feel able to breathe.');
        }
    } else if (r) {
        await remove_region(r);
        await update_topl('The gas cloud enveloping you dissipates.');
    } else {
        /* cloud dissipated on its own, so nothing needs to be done */
        await update_topl('The gas cloud has dissipated.');
    }
    /* maybe cure blindness too */
    if ((game.u?.blinded | 0) === 1) {
        const { make_blinded } = await import('./potion.js');
        await make_blinded(0, true);
    }
}
