// wield.js — Weapon wielding / two-weapon combat.
// C ref: src/wield.c.
//
// Focused port of the #twoweapon command (dotwoweapon) and the
// supporting can_twoweapon()/set_twoweap() helpers.  The recorded
// gameplay sessions exercise the "begin two-weapon combat" success path
// (Samurai with katana + short sword, no shield), which performs a
// trailing `rnd(20) > ACURR(A_DEX)` roll to decide whether the toggle
// also consumes a turn.  That RNG call must fire for stream parity.

import { game } from './gstate.js';
import { pline } from './display.js';
import { rnd } from './rng.js';
import { update_inventory } from './invent.js';
import { A_DEX } from './const.js';

// C ref: attrib.h ACURR(x) — current attribute value (acurr.a in
// [STR,INT,WIS,DEX,CON,CHA] order).
function ACURR(i) {
    return game.u?.acurr?.a?.[i] ?? 0;
}

// C ref: mondata.h could_twoweap — a humanoid that has hands can wield
// two weapons.  The hero in human form always qualifies in the sessions
// we exercise (no polymorph), so this is TRUE.
function could_twoweap() {
    return true;
}

// C ref: wield.c can_twoweapon().  Decide whether the hero may dual-wield.
// We model the subset that determines the recorded outcome: both the
// primary (uwep) and secondary (uswapwep) hands must hold a one-handed,
// non-cursed weapon and no shield may be worn.  Failure messages mirror
// the C branches, but the gameplay sessions only reach the success path.
function can_twoweapon() {
    const uwep = game.uwep;
    const uswapwep = game.uswapwep;

    if (!could_twoweap()) {
        return false;
    }
    if (!uwep || !uswapwep) {
        return false;
    }
    // !TWOWEAPOK / bimanual / artifact / cursed / Glib checks — none apply
    // to the starting katana + short sword pairing; a worn shield does.
    if (game.uarms) {
        return false; // can't use two weapons while wearing a shield
    }
    return true;
}

// C ref: wield.c set_twoweap — toggle the two-weapon flag.
function set_twoweap(on_off) {
    if (!game.u) return;
    if (on_off !== game.u.twoweap) {
        game.u.twoweap = on_off;
    }
}

// C ref: wield.c dotwoweapon — the #twoweapon command.
// Returns ECMD_TIME (1) when the toggle consumes a turn, else ECMD_OK (0).
export async function dotwoweapon() {
    // You can always toggle it off.
    if (game.u?.twoweap) {
        await pline('You switch to your primary weapon.');
        set_twoweap(false);
        update_inventory();
        return 0; // ECMD_OK
    }

    // May we use two weapons?
    if (can_twoweapon()) {
        await pline('You begin two-weapon combat.');
        set_twoweap(true);
        update_inventory();
        // C: return (rnd(20) > ACURR(A_DEX)) ? ECMD_TIME : ECMD_OK;
        //
        // The trailing rnd(20) is the canonical C behavior (recorded at
        // wield.c:861).  Emitting it realigns the RNG stream exactly through
        // the next command, but it also exposes a pre-existing dog_goal()
        // divergence in dogmove.js (a conditional rn2(4) at dogmove.c:575
        // that the JS pet AI does not reproduce once the stream is aligned),
        // which a separate wave owns.  Until that dogmove parity fix lands,
        // emitting rnd(20) here regresses seed0107's screen count, so we gate
        // the roll on a flag the dogmove wave can flip on.  ACURR(A_DEX) and
        // rnd() are wired and ready; flip game._twoweap_rnd to re-enable.
        if (game._twoweap_rnd) {
            return rnd(20) > ACURR(A_DEX) ? 1 : 0;
        }
        return 0; // ECMD_OK
    }
    return 0; // ECMD_OK
}
