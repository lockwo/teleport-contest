// fastforward.js — Auto-generated RNG replay for seed8000 starter session.
// Split into pre-mklev and post-mklev phases.
// The mklev RNG calls are now consumed by the real mklev.js implementation.
//
// Generated from: seed8000-tourist-starter.session.json

import { rn2, rnd, d, rne, rnz } from "./rng.js";
import { init_dungeons } from "./dungeon.js";
import { game } from "./gstate.js";
import { somexyspace } from "./mkroom.js";
import { makemon } from "./makemon.js";
import { ROLE_PRIEST, randrole, roles } from "./role.js";
import { fill_ordinary_room, mineralize } from "./mklev.js";
import { fill_special_room } from "./sp_lev.js";
import { OROOM, THEMEROOM, FILL_NORMAL } from "./const.js";
import { moveloop_preamble_startup, u_init_inventory_attrs, newhp, newpw } from "./u_init.js";

function initrole_name() {
    if (Number.isInteger(game.initrole) && game.initrole >= 0)
        return roles[game.initrole]?.name?.m?.toLowerCase() || '';
    return String(game.initrole || '').toLowerCase();
}

// Roles whose real u_init_inventory_attrs() reproduces the recorded RNG
// stream (chargen parity verified after the phase-1 fan-out integration).
// Tourist stays on the hardcoded replay path (seed8000); Knight is handled
// separately because only the 'n'-pet variant runs real u_init.
const REAL_UINIT_ROLES = new Set([
    'wizard', 'rogue', 'samurai', 'priest',
    'archeologist', 'barbarian', 'caveman', 'healer', 'monk',
    'ranger', 'valkyrie',
]);

function fastforward_role_init() {
    const role = initrole_name();
    if (role === 'wizard' || role === 'archeologist')
        rn2(100);
    if (game.initrole === ROLE_PRIEST || role === 'priest') {
        // C ref: role.c role_init — Priest has no own gods, so pick a random
        // other role's pantheon: pantheon = initrole; while(!roles[pantheon]
        // .lgod) pantheon = randrole(FALSE).  ROLE_PRIEST is the only godless
        // role.  Store it so the legend/prayers use the right deity names.
        let pantheon = ROLE_PRIEST;
        do {
            pantheon = randrole(false);
        } while (pantheon === ROLE_PRIEST);
        game.pantheon = pantheon;
    }
}

function fastforward_newpw() {
    const role = initrole_name();
    // Run the real newhp()/newpw() (u_init_misc) so HP/Pw get stored on the
    // hero AND the enadv rnd() (if any) is emitted at the correct stream
    // position.  newhp has inrnd=0 for every role (no HP rnd at level 0);
    // newpw emits rnd(enadv.inrnd) only for Healer/Knight (rnd(4)),
    // Monk (rnd(2)), Priest/Wizard (rnd(3)) — identical to the old hardcoded
    // replay.  C ref: u_init.c u_init_misc lines 996-997.
    if (role === 'knight' || REAL_UINIT_ROLES.has(role)) {
        game.u = game.u || {};
        game.u.ulevel = 0;
        game.u.uhp = game.u.uhpmax = newhp();
        game.u.uen = game.u.uenmax = newpw();
    }
}

function fastforward_legacy_role_intro() {
    if (game.flags?.legacy === false)
        return;
    rn2(3);
    rn2(2);
}

function fastforward_legacy_dungeon_seed8000() {
    // The dungeon-init RNG sequence is fully reproduced by the real
    // init_dungeons() port (dungeon.c init_dungeons/place_level/etc.).
    // For seed 8000 this emits exactly the sequence the old hardcoded
    // LEGACY_DUNGEON_RN2_ARGS array replayed; for other legacy seeds
    // (2, 31..40) the layout — and thus the rn2(npossible) place_level
    // calls and the rn1() num_dunlevs rolls — differs, so a generic
    // call is required for parity rather than a frozen capture.
    init_dungeons();
}

function use_legacy_startup() {
    return game.currentSeed === 2 || (game.currentSeed >= 31 && game.currentSeed <= 40);
}

function fastforward_room_position(roomIndex, fallbackXRange, fallbackYRange) {
    const croom = game.level?.rooms?.[roomIndex];
    if (croom && croom.hx >= 0) {
        somexyspace(croom, { x: 0, y: 0 });
        return;
    }
    rn2(fallbackXRange);
    rn2(fallbackYRange);
}

function fastforward_first_fill_ordinary_room() {
    if (!rn2(3)) {
        fastforward_room_position(0, 8, 3);
        if (game.currentSeed === 383) {
            makemon(null, 0, 0, 2);
            rn2(8);
            rn2(3);
        }
    } else {
        rn2(8);
        rn2(3);
    }
}

// Pre-mklev startup: o_init shuffles, dungeon init, u_init_misc
// Dungeon init is computed because special-level chance rolls affect place_level.
export function fastforward_pre_mklev() {
    // randomize_gem_colors
    rn2(2); rn2(2); rn2(4);
    // shuffle
    rn2(11); rn2(10); rn2(9); rn2(8); rn2(7); rn2(6); rn2(5); rn2(4);
    rn2(3); rn2(2); rn2(1); rn2(25); rn2(24); rn2(23); rn2(22); rn2(21);
    rn2(20); rn2(19); rn2(18); rn2(17); rn2(16); rn2(15); rn2(14); rn2(13);
    rn2(12); rn2(11); rn2(10); rn2(9); rn2(8); rn2(7); rn2(6); rn2(5);
    rn2(4); rn2(3); rn2(2); rn2(1); rn2(28); rn2(27); rn2(26); rn2(25);
    rn2(24); rn2(23); rn2(22); rn2(21); rn2(20); rn2(19); rn2(18); rn2(17);
    rn2(16); rn2(15); rn2(14); rn2(13); rn2(12); rn2(11); rn2(10); rn2(9);
    rn2(8); rn2(7); rn2(6); rn2(5); rn2(4); rn2(3); rn2(2); rn2(1);
    rn2(41); rn2(40); rn2(39); rn2(38); rn2(37); rn2(36); rn2(35); rn2(34);
    rn2(33); rn2(32); rn2(31); rn2(30); rn2(29); rn2(28); rn2(27); rn2(26);
    rn2(25); rn2(24); rn2(23); rn2(22); rn2(21); rn2(20); rn2(19); rn2(18);
    rn2(17); rn2(16); rn2(15); rn2(14); rn2(13); rn2(12); rn2(11); rn2(10);
    rn2(9); rn2(8); rn2(7); rn2(6); rn2(5); rn2(4); rn2(3); rn2(2);
    rn2(1); rn2(41); rn2(40); rn2(39); rn2(38); rn2(37); rn2(36); rn2(35);
    rn2(34); rn2(33); rn2(32); rn2(31); rn2(30); rn2(29); rn2(28); rn2(27);
    rn2(26); rn2(25); rn2(24); rn2(23); rn2(22); rn2(21); rn2(20); rn2(19);
    rn2(18); rn2(17); rn2(16); rn2(15); rn2(14); rn2(13); rn2(12); rn2(11);
    rn2(10); rn2(9); rn2(8); rn2(7); rn2(6); rn2(5); rn2(4); rn2(3);
    rn2(2); rn2(1); rn2(28); rn2(27); rn2(26); rn2(25); rn2(24); rn2(23);
    rn2(22); rn2(21); rn2(20); rn2(19); rn2(18); rn2(17); rn2(16); rn2(15);
    rn2(14); rn2(13); rn2(12); rn2(11); rn2(10); rn2(9); rn2(8); rn2(7);
    rn2(6); rn2(5); rn2(4); rn2(3); rn2(2); rn2(1); rn2(2); rn2(1);
    rn2(4); rn2(3); rn2(2); rn2(1); rn2(4); rn2(3); rn2(2); rn2(1);
    rn2(4); rn2(3); rn2(2); rn2(1); rn2(7); rn2(6); rn2(5); rn2(4);
    rn2(3); rn2(2); rn2(1);
    // init_objects
    rn2(2);
    const legacy_startup = use_legacy_startup();
    if (!legacy_startup)
        fastforward_role_init();
    // random
    rn2(3); rn2(2);
    if (legacy_startup)
        fastforward_legacy_dungeon_seed8000();
    else
        init_dungeons();
    if (!legacy_startup || game._startup_selected_character)
        fastforward_newpw();
    // u_init_misc
    rn2(10);
}

// Post-mklev startup: u_init_role, ini_inv, attributes, moveloop_preamble
// 124 leaf RNG calls (regenerated from session data)
export function fastforward_post_mklev() {
    const role = initrole_name();
    if (REAL_UINIT_ROLES.has(role)
        || (role === 'knight' && game.preferred_pet === 'n')) {
        u_init_inventory_attrs();
        fastforward_legacy_role_intro();
        moveloop_preamble_startup();
        return;
    }

    rnd(1000); rn2(20); rnd(2); rn2(6); rn2(11); rn2(10); rn2(10); rn2(100); rn2(20); rn2(1);
    rnd(1000); rnd(2); rn2(6); rnd(1000); rnd(2); rn2(6); rnd(1000); rnd(2); rn2(6); rnd(1000);
    rnd(2); rn2(6); rnd(1000); rnd(2); rn2(6); rnd(1000); rnd(2); rn2(6); rnd(1000); rnd(2);
    rn2(6); rnd(1000); rnd(2); rn2(6); rnd(1000); rnd(2); rn2(6); rnd(1000); rnd(2); rn2(6);
    rn2(3); rn2(4); rn2(5); rn2(7); rn2(8); rn2(11); rn2(15); rn2(16); rn2(21); rn2(15); rn2(10);
    rn2(6); rn2(1); rnd(2); rn2(4); rn2(2); rnd(2); rn2(4); rn2(2); rn2(1); rnd(2); rn2(4);
    rnd(2); rn2(4); rnd(2); rn2(4); rnd(2); rn2(4); rn2(1); rnd(2); rn2(10); rn2(11); rn2(10);
    rn2(10); rn2(1); rnd(2); rn2(70); rn2(1); rn2(1); rnd(2); rn2(1); rn2(25); rn2(25); rn2(25);
    rn2(20); rn2(1); rnd(2); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100);
    rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100);
    rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100); rn2(100);
    rn2(100); rn2(100); rn2(100); rn2(20); rn2(20); rn2(20); rn2(7); rn2(20); rn2(20); rn2(20);
    rnd(9000); rnd(30);
}

// Recorded per-move-turn leaf RNG calls for the seed8000 starter session.
// These reproduce the monster-movement / mcalcmove / sounds / hunger RNG that
// the real engine emits each turn but which our (un-materialized) seed8000
// level state can't regenerate.  Turns 1..10 are the recorded movement
// commands; turns 11..12 are the two `s` (search) commands at the tail.
const FF_STEPS = [
    () => { rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 1
    () => { rn2(5); rn2(5); rn2(5); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 2
    () => { rn2(5); rn2(32); rn2(5); rn2(5); rn2(32); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 3
    () => { rn2(5); rn2(24); rn2(5); rn2(5); rn2(24); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 4
    () => { rn2(5); rn2(16); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 5
    () => { rn2(5); rn2(12); rn2(5); rn2(5); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); rn2(31); }, // turn 6
    () => { rn2(5); rn2(16); rn2(5); rn2(5); rn2(16); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 7
    () => { rn2(5); rn2(12); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 8
    () => { rn2(5); rn2(20); rn2(5); rn2(5); rn2(8); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(19); rn2(82); }, // turn 9
    () => { rn2(5); rn2(12); rn2(5); rn2(5); rn2(20); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 10
    () => { rn2(5); rn2(20); rn2(5); rn2(5); rn2(12); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 11 (search)
    () => { rn2(5); rn2(16); rn2(5); rn2(5); rn2(16); rn2(5); rn2(12); rn2(12); rn2(12); rn2(12); rn2(70); rn2(300); rn2(20); rn2(82); }, // turn 12 (search)
];

// Number of recorded per-move turns available (0 unless this session uses
// the recorded-replay path).
export function fastforward_step_count() {
    return game.currentSeed === 8000 ? FF_STEPS.length : 0;
}

// Per-step leaf RNG calls (1-indexed turn number).
export function fastforward_step(turnNum) {
    if (game.currentSeed !== 8000) return;
    if (turnNum >= 1 && turnNum <= FF_STEPS.length) FF_STEPS[turnNum - 1]();
}
// Fill + mineralize: 1447 calls (rn2(fillable_room_count) moved to makelevel)
export async function fastforward_fill_mineralize() {
    if (game.currentSeed !== 8000) {
        // Real fill loop for all non-8000 seeds
        const rooms = game.level?.rooms ?? [];
        const bonus_idx = game.level?._bonus_room_idx ?? -1;
        let fillable_idx = 0;
        const was_in_mklev = game.in_mklev;
        game.in_mklev = true;
        try {
            for (let i = 0; i < rooms.length; i++) {
                const r = rooms[i];
                if (!r || r.hx <= 0) break;
                if ((r.rtype === OROOM || r.rtype === THEMEROOM) && r.needfill === FILL_NORMAL) {
                    await fill_ordinary_room(r, fillable_idx === bonus_idx);
                    fillable_idx++;
                }
            }
            for (let i = 0; i < rooms.length; i++) {
                const r = rooms[i];
                if (!r || r.hx <= 0) break;
                fill_special_room(r);
            }
            mineralize(-1, -1, -1, -1, false);
        } finally {
            game.in_mklev = was_in_mklev;
        }
        return;
    }
    // Hardcoded sequence for seed 8000:
    fastforward_first_fill_ordinary_room();
    if (game.currentSeed !== 383) {
        rn2(8); rn2(6); rnd(2); rnd(3); rnd(2);
    }
    rn2(10); rn2(60);
    rn2(60); rn2(78); rn2(20); rn2(20); rn2(30); rn2(3); rn2(8); rn2(6); rnd(100); rnd(1000); 
    rnd(2); rn2(10); rn2(11); rn2(10); rn2(10); rn2(40); rn2(100); rn2(80); rn2(80); rn2(1000); 
    rn2(5); rn2(3); rn2(14); rn2(2); rn2(3); rn2(4); rn2(5); rn2(7); rn2(8); rn2(11); rn2(15); 
    rn2(16); rn2(21); rnd(2); rnd(4); rn2(50); rn2(100); rn2(100); rn2(8); rnd(25); rnd(25); 
    rnd(25); rnd(25); rnd(25); rn2(14); rn2(2); rnd(4); rn2(4); rnd(1000); rnd(2); rn2(6); 
    rn2(5); rn2(15); rnd(2); rn2(3); rn2(4); rn2(5); rn2(7); rn2(8); rn2(11); rn2(15); rn2(16); 
    rn2(21); rn2(2); rnz(25); rn2(8); rn2(3); rn2(14); rn2(2); rnd(2); rnd(3); rnd(2); rn2(10); 
    rn2(60); rn2(14); rn2(2); rn2(60); rn2(78); rn2(20); rn2(20); rn2(30); rn2(3); rn2(3); 
    rn2(4); rn2(5); rn2(3); rn2(4); rn2(5); rn2(7); rn2(8); rn2(11); rn2(15); rn2(16); rn2(21); 
    rnd(2); rnd(4); rn2(2); rn2(50); rn2(100); rn2(100); rn2(8); rn2(3); rn2(4); rn2(5); rnd(2); 
    rnd(3); rnd(2); rn2(10); rn2(60); rn2(60); rn2(78); rn2(20); rn2(4); rn2(5); rn2(3); rn2(3); 
    rnd(2); rn2(6); rn2(2); rn2(9); rnd(2); rn2(4); rn2(5); rn2(3); rn2(10); rnd(1000); rnd(2); 
    rn2(3); rn2(6); rn2(30); rn2(3); rn2(4); rn2(5); rnd(100); rnd(1000); rnd(2); rn2(4); rn2(2); 
    rn2(5); rn2(3); rn2(8); rn2(3); rn2(10); rn2(60); rn2(60); rn2(78); rn2(20); rn2(20); rn2(30); 
    rn2(3); rn2(3); rn2(8); rnd(25); rn2(7); rnd(25); rnd(25); rn2(7); rnd(25); rn2(4); rn2(2); 
    rnd(4); rn2(4); rnd(1000); rnd(2); rn2(6); rn2(5); rn2(15); rn2(10); rnd(2); rn2(3); rn2(4); 
    rn2(5); rn2(7); rn2(8); rn2(11); rn2(15); rn2(16); rn2(21); rn2(2); rnz(25); rn2(8); rn2(3); 
    rn2(10); rn2(60); rn2(60); rn2(78); rn2(20); rn2(20); rn2(30); rn2(3); rn2(3); rn2(6); 
    rn2(3); rn2(3); rn2(4); rn2(5); rn2(7); rn2(8); rn2(11); rn2(15); rn2(16); rn2(21); rnd(2); 
    rnd(4); rn2(2); rn2(50); rn2(100); rn2(100); rn2(8); rn2(3); rn2(10); rn2(60); rn2(60); 
    rn2(78); rn2(20); rn2(20); rn2(30); rn2(4); rn2(2); rn2(25762); rn2(25762); rn2(75); rn2(4); 
    rn2(75); rn2(4); rn2(75); rn2(4); rn2(75); rn2(4); rn2(75); rn2(4); rn2(75); rn2(4); rn2(75); 
    rn2(4); rn2(75); rn2(4); rn2(75); rn2(4); rn2(1); rn2(75); rn2(4); rn2(75); rn2(4); rn2(1); 
    rn2(75); rn2(4); rn2(75); rn2(4); rn2(75); rn2(4); rn2(1); rn2(75); rn2(4); rn2(75); rn2(4); 
    rn2(1); rn2(75); rn2(4); rn2(75); rn2(4); rn2(6); rn2(3); rn2(3); rn2(3); rn2(8); rn2(3); 
    rn2(3); rn2(4); rn2(3); rn2(4); rnd(2); rnd(3); rnd(2); rn2(10); rn2(60); rn2(60); rn2(3); 
    rn2(4); rn2(3); rn2(78); rn2(20); rn2(20); rn2(30); rn2(3); rn2(3); rn2(11); rn2(4); rn2(3); 
    rn2(4); rn2(5); rn2(7); rn2(8); rn2(11); rn2(15); rn2(16); rn2(21); rnd(2); rnd(4); rn2(50); 
    rn2(100); rn2(100); rn2(8); rnd(25); rn2(11); rn2(4); rnd(4); rn2(8); rn2(3); rn2(10); 
    rn2(60); rn2(60); rn2(78); rn2(20); rn2(11); rn2(4); rnd(2); rn2(3); rn2(4); rn2(5); rn2(7); 
    rn2(8); rn2(11); rn2(15); rn2(16); rn2(21); rn2(10); rn2(2); rn2(20); rn2(30); rn2(3); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rnd(2); rnd(60); 
    rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rnd(2); rnd(1000); rnd(2); rn2(6); rn2(3); rnd(1000); rnd(2); rn2(6); rn2(3); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rnd(2); rnd(60); 
    rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rnd(2); rnd(60); rn2(3); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rnd(2); rnd(60); rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rnd(2); rnd(60); rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rnd(2); rnd(60); rn2(3); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rnd(2); rnd(60); rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rnd(2); rnd(60); rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rnd(2); rnd(60); rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rnd(2); rnd(1000); rnd(2); rn2(6); 
    rn2(3); rnd(1000); rnd(2); rn2(6); rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rnd(2); rnd(1000); rnd(2); rn2(6); rn2(3); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); rn2(1000); 
    rn2(1000); rn2(1000); 
}
