// end.js — hero death / done() flow.
//
// C ref: src/end.c — done_in_by(), done(), savelife().  Scoped to the path the
// contest sessions exercise: a hostile melee attack drops the hero to 0 HP in
// WIZARD mode, the player declines the "Die?" paranoid query, savelife() restores
// HP and sets a one-turn immobilization whose nomovemsg is "You survived that
// attempt on your life." (seed5002 step-256..272).  No RNG is consumed on this
// path: adjattrib(A_CON,-1) only rolls when Con would drop below its minimum
// (it can't here), and savelife()'s HP/hunger fixups are deterministic.

import { game } from './gstate.js';
// C ref: monflag.h G_GENOD / G_EXTINCT — the two mvitals[].mvflags "gone" bits.
import { G_GENOD, G_EXTINCT } from './const.js';

// end.h death codes (subset).  DIED=0; GENOCIDED separates the death codes
// that leave a tombstone/bones from the ones that don't (QUIT/ESCAPED/
// ASCENDED); PANICKED separates "real" deaths from program panics in done().
const DIED = 0;
const ESCAPED = 14;   // C: hack.h:497
const ASCENDED = 15;  // C: hack.h:498
const GENOCIDED = 10;
const PANICKED = 11;
const QUIT = 13;

// C ref: end.c ends[] — "when you %s" phrasing per death code (also the
// "You %s in <dungeon>" verb for the score summary).
const ENDS = [
    'died', 'choked', 'were poisoned', 'starved', 'drowned', 'burned',
    'dissolved in the lava', 'were crushed', 'turned to stone',
    'turned into slime', 'were genocided', 'panicked', 'were tricked',
    'quit', 'escaped', 'ascended',
];
// C ref: end.c deaths[] — noun form used when no killer text is available.
const DEATHS = [
    'died', 'choked', 'poisoned', 'starvation', 'drowning', 'burning',
    'dissolving under the heat and pressure', 'crushed', 'turned to stone',
    'turned into slime', 'genocided', 'panic', 'trickery', 'quit',
    'escaped', 'ascended',
];

// C ref: role.c Goodbye() — role-specific farewell for the score summary line.
function goodbye_for_role(roleName) {
    switch (roleName) {
    case 'Knight':   return 'Fare thee well';
    case 'Samurai':  return 'Sayonara';
    case 'Tourist':  return 'Aloha';
    case 'Valkyrie': return 'Farvel';
    default:         return 'Goodbye';
    }
}

// C ref: hack.h plur(x) — "" when x == 1, "s" otherwise.
function plur(n) { return (n === 1) ? '' : 's'; }

// C ref: restore.c:583 "wizard and discover are actually flags.debug and
// flags.explore".  Our rc parser records `playmode:explore` as
// flags.playmode === 'explore' and never sets flags.explore, so reading only
// flags.discover (as this file used to) answered FALSE for every explore game:
// done() then skipped the "Die?" paranoid query entirely and killed a hero C
// keeps alive.  Same predicate as bones.js is_discover() / insight.js.
function is_discover() {
    const f = game.flags || {};
    return !!(f.explore || f.discover || f.playmode === 'explore');
}
// C ref: options.c optfn_playmode() — `playmode:debug` sets wizard.
function is_wizard() { return !!game.flags?.debug; }

// Sum the coins carried directly in `inv` (C ref: engrave.c money_cnt — does NOT
// descend into containers; that is hidden_gold()'s job).
// C ref: dungeon.c:1338 deepest_lev_reached(noquest) — the deepest DEPTH the
// hero reached in any dungeon, not the depth they happened to die on.
function deepest_lev_reached_js(noquest = false) {
    const dgns = game.dungeons || [];
    let ret = 0;
    for (let i = 0; i < dgns.length; i++) {
        const d = dgns[i];
        if (!d || (noquest && i === game.quest_dnum)) continue;
        const dl = d.dunlev_ureached || 0;
        if (!dl) continue;
        const dep = (d.depth_start ?? 1) + dl - 1;
        if (dep > ret) ret = dep;
    }
    return ret;
}

function money_toplevel(inv) {
    let s = 0;
    for (const o of inv) if (o && o.oclass === COIN_CLASS) s += o.quan || 0;
    return s;
}
// C ref: invent.c hidden_gold(TRUE) — total gold stashed inside carried
// containers (recursively).  Kept separate from money_toplevel() so the score
// calculation mirrors end.c (umoney = money_cnt + hidden_gold).
function hidden_gold_inv(inv) {
    let s = 0;
    for (const o of inv) {
        if (o?.cobj) {
            for (const c of o.cobj) {
                if (c?.oclass === COIN_CLASS) s += c.quan || 0;
                if (c?.cobj) s += hidden_gold_inv([c]);
            }
        }
    }
    return s;
}
const COIN_CLASS = 12; // mkobj.js COIN_CLASS

// C ref: end.c really_done() endgame display + rip.c outrip() + topten().
// Reached from done_selfzap()/done() once the hero has actually died (the
// wizard-mode "Die?" query was accepted and, if bones are possible, "Save
// bones?" answered).  Renders the tombstone page, the tty window-teardown
// --More-- acknowledgements, and (in wizard/discover mode) the topten
// "score list will not be checked" line, driving nhgetch() at each boundary so
// every frame is captured.  The final nhgetch() exhausts the recorded input and
// terminates the segment (as the moveloop's own read would otherwise do).
export async function outrip_and_score(how) {
    const disp = game?.nhDisplay;
    const { nhgetch } = await import('./input.js');
    if (!disp?.putstr) { // no display (shouldn't happen in replay) — just end.
        game.program_state = game.program_state || {};
        game.program_state.gameover = true;
        return;
    }
    const { genl_outrip } = await import('./rip.js');
    const u = game.u;
    const NO_COLOR = 8; // terminal.js NO_COLOR (default fg; emits no SGR escape)
    const ROWS = 24;

    // ── gather the values engraved / printed ──
    const plname = game.plname || game.svp?.plname || 'wizard';
    const female = !!game.flags?.female;
    const roleName = (female && game.urole?.name?.f)
        ? game.urole.name.f
        : (game.urole?.name?.m || 'Adventurer');
    const inv = Array.isArray(game.invent) ? game.invent
        : (Array.isArray(game.gi?.invent) ? game.gi.invent : []);
    // umoney = money_cnt(invent) + hidden_gold(TRUE); gd.done_money = umoney.
    const umoney = money_toplevel(inv) + hidden_gold_inv(inv);

    // depth of the death level (dnum 0 -> depth == dlevel).
    const uz = u?.uz || { dnum: 0, dlevel: 1 };
    const dungeonName = game.dungeons?.[uz.dnum]?.dname || 'The Dungeons of Doom';
    const depth = (game.dungeons?.[uz.dnum]?.depth_start ?? 1) + (uz.dlevel | 0) - 1;

    // C ref: end.c really_done() score calc + dungeon.c:1338 deepest_lev_reached().
    // Using the CURRENT depth loses 50 points per level for any hero who
    // descends and then climbs back before dying.
    const deepest = deepest_lev_reached_js(false) || depth;
    let tmp = umoney - (u?.umoney0 || 0);
    if (tmp < 0) tmp = 0;
    if (how < PANICKED) tmp -= Math.trunc(tmp / 10);
    tmp += 50 * (deepest - 1);
    if (deepest > 20) tmp += 1000 * ((deepest > 30) ? 10 : deepest - 20);
    const urexp = (u?.urexp || 0) + tmp;

    // Death description for the tombstone (formatkiller with NO_KILLER_PREFIX
    // just yields killer.name).  ends[]/deaths[] fall back for the summary.
    const deathText = game._killer_name || DEATHS[how] || 'died';
    const year = (+String(game.datetime || '').slice(0, 4)) || 2020;
    const moves = (game.moves == null ? 0 : (game.moves | 0));

    // ── build the endgame TEXT window (24 lines), C ref rip.c + end.c ──
    const lines = [];
    // C: end.c really_done() draws the stone only for a death (how <= GENOCIDED);
    // ESCAPED/ASCENDED/QUIT get the text summary alone, and their middle line is
    // "You escaped from the dungeon with N points," (end.c:1475) rather than the
    // "in <dungeon> on dungeon level N" form.
    const stone = how <= GENOCIDED;
    if (stone) {
        lines.push('');                                // 0 (genl_outrip leading "")
        for (const r of genl_outrip(plname, umoney, deathText, year))
            lines.push(r);                             // 1..15 (stone)
        lines.push('');                                // 16 (genl_outrip trailing "")
        lines.push('');                                // 17
    }
    lines.push(`${goodbye_for_role(roleName)} ${plname} the ${roleName}...`); // 18
    lines.push('');                                    // 19
    lines.push((how !== ESCAPED && how !== ASCENDED)
        ? `You ${ENDS[how]} in ${dungeonName} on dungeon level ${depth}`
          + ` with ${urexp} point${plur(urexp)},`
        : `You ${how === ASCENDED ? 'went to your reward' : 'escaped from the dungeon'}`
          + ` with ${urexp} point${plur(urexp)},`);    // 20
    lines.push(`and ${umoney} piece${plur(umoney)} of gold, after ${moves} move${plur(moves)}.`); // 21
    lines.push(`You were level ${u?.ulevel || 1} with a maximum of ${u?.uhpmax || 0}`
        + ` hit point${plur(u?.uhpmax || 0)} when you ${ENDS[how]}.`); // 22
    lines.push('');                                    // 23

    const MORE = '--More--';
    const drawMore = (row) => {
        for (let i = 0; i < MORE.length; i++) disp.setCell(i, row, MORE[i], NO_COLOR, 0);
        disp.setCursor(MORE.length, row); // cursor one past --More-- (col 8)
    };

    // C ref: getline.c xwaitforspace(quitchars) behind every dmore() — only
    // " \r\n\033" dismiss the page; any other key rings the bell and waits
    // again WITHOUT redrawing, so it is recorded as a repeat of the same frame.
    const waitforspace = async () => {
        for (;;) {
            const k = await nhgetch();
            if (k === 32 || k === 13 || k === 10 || k === 27) return k;
        }
    };

    // Page 1 — the tombstone.  C tty process_text_window() prints window lines
    // 0..(rows-2) then pauses with --More-- on the last row (rows-1 == 23).
    disp.clearScreen();
    for (let i = 0; i < ROWS - 1 && i < lines.length; i++) {
        if (lines[i]) disp.putstr(0, i, lines[i], NO_COLOR, 0);
    }
    drawMore(ROWS - 1);
    // wintty.c:1821 — ESC sets WIN_CANCELLED and abandons every remaining page.
    const ripCancelled = (await waitforspace()) === 27;

    // The remaining pages are blank --More-- acknowledgements: process_text_window
    // clears and shows its final page (window line 23 == "" -> blank) with
    // --More--, then the endgame window teardown / topten() setup pauses for the
    // recorded space/return acknowledgements before the score line is printed.
    for (let b = 0; !ripCancelled && b < 5; b++) {
        disp.clearScreen();
        drawMore(ROWS - 1);
        // NOT waitforspace(): this port folds really_done()'s disclosure
        // queries into these frames, and those answer keys ('y'/'n') are not
        // quitchars — looping here would swallow the next command.
        await nhgetch();
    }

    // topten() in wizard/discover mode: raw_print("") then raw_print(msg) — two
    // lines to the bare screen (no --More--); cursor ends on the row after.
    // C ref: topten.c topten() wizard branch + tty raw_print.
    disp.clearScreen();
    const wizard = !!game.flags?.debug;
    const msg = `Since you were in ${wizard ? 'wizard' : 'discover'} mode,`
        + ' the score list will not be checked.';
    disp.putstr(0, 1, msg, NO_COLOR, 0);
    disp.setCursor(0, 2);
    game.program_state = game.program_state || {};
    game.program_state.gameover = true;
    // Final read: consumes the last recorded key (or exhausts the queue, which
    // ends the segment exactly as the moveloop's own command read would).
    await nhgetch();
}

let _display = null;
async function deps() {
    if (!_display) _display = await import('./display.js');
    return _display;
}

// C ref: end.c savelife(how) — put the hero back into a viable state after a
// declined death.  givehp = 50 + 10*(ACURR(A_CON)/2), clamped to uhpmax; the
// hero is immobilized for the rest of the turn (multi = -1) and unmul() will
// announce nomovemsg ("You survived that attempt on your life.") when the turn
// completes.
function savelife(_how) {
    const u = game.u;
    if ((u.ulevel ?? 1) < 1) u.ulevel = 1;
    // minuhpmax(10): ensure uhpmax is at least 10 (it already exceeds that here).
    if ((u.uhpmax ?? 0) < 10) u.uhpmax = 10;
    const con = u.acurr?.a?.[4] ?? 10; // ACURR(A_CON)
    const givehp = 50 + 10 * Math.trunc(con / 2);
    u.uhp = Math.min(u.uhpmax, givehp);
    if (u.mh != null && u.mhmax != null) u.mh = Math.min(u.mhmax, givehp);
    // init_uhunger() only when uhunger < 500: the wizard starts well-fed, skip.

    // gn.nomovemsg = "You survived that attempt on your life."; context.move = 0;
    // gm.multi = -1 (can't move again during the current turn).  The moveloop's
    // unmul() will print nomovemsg when ++multi reaches 0.
    game.nomovemsg = 'You survived that attempt on your life.';
    game.context = game.context || {};
    game.context.move = 0;
    game.multi = -1;
}

// C ref: end.c done(how) — for how < PANICKED, zero the hero's HP, then (in
// wizard/explore mode) offer the paranoid "Die?" query.  Declining runs
// savelife() and lets play continue; accepting ends the game.  Only the
// wizard-mode decline path is exercised by the contest sessions.
// C ref: end.c:1303-1319 — the hero's corpse and grave, created between
// disclose() and savebones() ("grave creation should be after disclosure so it
// doesn't have this grave in the current level's features for #overview").
//
//   corpse = mk_named_object(CORPSE, &mons[mnum], u.ux, u.uy, svp.plname);
//   make_grave(u.ux, u.uy, pbuf);
//
// mk_named_object() is mkcorpstat(CORPSE, NULL, ptr, x, y, CORPSTAT_INIT) plus
// oname().  Skipping it cost 29 RNG calls on every bones-eligible death:
// next_ident's rnd(2), the 23 rn2 @ rndmonst_adj that mksobj's rndmonnum()
// rolls for the CORPSE's placeholder corpsenm, and start_corpse_timeout's 5
// (seed0030 seg6 step 247 idx 0-28, verified against the C recorder).  The
// draws happen even though the corpsenm is immediately overwritten with the
// hero's race.  make_grave() itself draws nothing when given a text.
//
// C's guard is `u.ugrave_arise == NON_PM && !(mvitals[u.umonnum].mvflags &
// G_NOCORPSE)`; ugrave_arise is set from `how` at end.c:1206-1218, so the
// death codes that leave no ordinary corpse are the ones excluded here.
async function make_hero_corpse_and_grave(how) {
    const BURNING = 5, DISSOLVED = 6, STONING = 8, TURNED_SLIME = 9;
    if (how === PANICKED || how === BURNING || how === DISSOLVED
        || how === STONING || how === TURNED_SLIME)
        return null;
    try {
        const u = game.u;
        const x = u?.ux, y = u?.uy;
        if (!x && !y) return null;
        const { mkcorpstat, CORPSE } = await import('./mkobj.js');
        const { name_to_pmidx } = await import('./makemon.js');
        const { make_grave } = await import('./engrave.js');
        const { CORPSTAT_INIT } = await import('./const.js');
        // C: `int mnum = !Upolyd ? gu.urace.mnum : u.umonnum;`  This port's
        // u.umonnum holds the ROLE index, not a mons[] pmidx, so resolve the
        // race's monster by name (mons[] carries "human"/"elf"/"dwarf"/
        // "gnome"/"orc" as the player-race entries).
        const raceName = String(game.urace?.noun || game.urace?.name
                                || game.initrace || 'human').toLowerCase();
        const mnum = name_to_pmidx(raceName);
        const corpse = mkcorpstat(CORPSE, null, mnum ?? null, x, y,
                                  CORPSTAT_INIT);
        const plname = game.plname || game.u?.uname || 'Hero';
        if (corpse) corpse.oname = plname;
        // C: Sprintf(pbuf, "%s, ", plname); formatkiller(...); make_grave().
        make_grave(x, y, `${plname}, ${killer_epitaph(how)}`);
        return corpse;
    } catch {
        return null;   // never break the death sequence over a bones artifact
    }
}

// C ref: topten.c formatkiller(..., how, TRUE) as used for the headstone text.
function killer_epitaph(how) {
    const kn = game._killer_name || '';
    if (kn) return kn;
    return DEATHS[how] || 'died';
}

// C ref: end.c:851 done_object_cleanup() — deal with objects left in an
// abnormal state by the death blow.  The hero can die *while* a missile is in
// transit (an arrow that mortally wounds them is still OBJ_FREE: out of the
// thrower's inventory and not yet on the map), and savebones() would lose it.
// C puts it on the map at u.ux+u.dx, u.uy+u.dy — the square the hero was
// facing — falling back to the hero's own square when that isn't accessible,
// deliberately bypassing flooreffects().  No RNG.
// Only the thrown/kicked-missile arm is modelled: inven_inuse()'s disposable
// items and the Punished uball/uchain limbo have no counterpart here (nothing
// in js/ leaves them OBJ_FREE), and perm_invent is never on.
async function done_object_cleanup() {
    try {
        const u = game.u;
        if (!u) return;
        const { place_object } = await import('./mkobj.js');
        const { stackobj } = await import('./invent.js');
        const { isok, ACCESSIBLE, IS_DOOR, D_CLOSED, D_LOCKED } = await import('./const.js');
        // monmove.c:2188 accessible() == ACCESSIBLE(typ) && !closed_door(x,y).
        const accessible = (x, y) => {
            const lev = game.level?.at?.(x, y);
            return !!lev && ACCESSIBLE(lev.typ)
                && !(IS_DOOR(lev.typ) && (lev.doormask & (D_CLOSED | D_LOCKED)));
        };
        let ox = (u.ux | 0) + (u.dx | 0), oy = (u.uy | 0) + (u.dy | 0);
        if (!isok(ox, oy) || !accessible(ox, oy)) { ox = u.ux; oy = u.uy; }
        const floor = game.level?.objects || [];
        for (const key of ['thrownobj', 'kickedobj']) {
            const obj = game[key];
            // C tests `where == OBJ_FREE`; ours is the mirror test that the
            // object reached neither the map nor an inventory.
            if (obj && !floor.includes(obj) && !(game.invent || []).includes(obj)) {
                place_object(obj, ox, oy);
                stackobj(obj);
            }
            game[key] = null;
        }
    } catch { /* cleanup is best-effort; never break the death sequence */ }
}

async function done(how) {
    const d = await deps();
    const u = game.u;
    const stopprint = !!game._done_stopprint;

    // how < PANICKED: force HP to zero (it may already be <= 0) and redraw
    // bot.  Skip the forced status update when quitting via a 'q' answer to
    // "Dump core?" (done_stopprint) — end.c done(): disp.botl = FALSE etc.
    // C ref: end.c:1044 — the forced status update comes FIRST (end.c:1048),
    // and only then does end.c:1071 zero u.uhp, with no second bot().  Doing it
    // in the other order let the zeroed HP reach the endgame screens.
    if (!(how === QUIT && stopprint)) {
        d.freeze_botl();
        await d.bot();
        await d.flush_screen(1);
    }
    if (how < PANICKED) {
        // MEASURED NEGATIVE, do not re-add: C's end.c:1071 also sets
        // disp.botl = TRUE after zeroing HP, so a later refresh redraws the
        // status with HP:0 even when the bot() above drew nothing (u.uhp was
        // exactly -1, botl.c's dosave() sentinel).  Re-freezing the botl here
        // wins seed0030's step 582 but costs seed5002 -12, the held-out proxy
        // -14 and seed0030's own step 779.  The extra release point is the
        // botl-is-a-snapshot trap; some other frame must be re-releasing it.
        u.uhp = 0;
        if (u.mh != null) u.mh = 0;
    }

    // C ref: end.c:1081 — `if (Lifesaved && (how <= GENOCIDED))`.  Lifesaved is
    // the LIFESAVED extrinsic, conferred only by a worn amulet of life saving.
    let survive = false;
    const uamul = game.uamul || game.u?.uamul;
    if (uamul && uamul.otyp === 202 /*AMULET_OF_LIFE_SAVING*/ && how <= GENOCIDED) {
        const I = await import('./invent.js');
        // C ref: end.c:1077 sets disp.botl = TRUE after zeroing uhp, so the
        // plines below reach bot() with a LIVE status line again.
        game._botlFrozen = null;
        game.botl = true;
        await d.update_topl('But wait...');
        I.makeknown(202);
        await d.update_topl(`Your medallion ${!game.u?.Blinded ? 'begins to glow' : 'feels warm'}!`);
        await d.update_topl('You feel much better!');
        await d.update_topl('The medallion crumbles to dust!');
        I.useup(uamul);
        // C ref: end.c:1092 adjattrib(A_CON, -1, TRUE) — no RNG.
        if (game.u?.acurr?.a) game.u.acurr.a[4] = (game.u.acurr.a[4] | 0) - 1;
        if (game.u?.abase?.a) game.u.abase.a[4] = (game.u.abase.a[4] | 0) - 1;
        savelife(how);
        survive = true;
    }

    // explore/wizard mode: offer the "Die?" paranoid query — but only for
    // how <= GENOCIDED (end.c done()); QUIT/ESCAPED/ASCENDED skip it outright.
    // paranoid_query shows the deferred "You die...--More--" first
    // (game._yn_need_more) then "Die? [yn] (n)".  A 'y' would end the game;
    // the contest player declines.
    const wizard = is_wizard();
    const discover = is_discover();
    if (!survive && (wizard || discover) && how <= GENOCIDED) {
        game._yn_need_more = true; // page the pending "You die..." line first
        const ans = await d.y_n('Die?', 'yn\x1b', 'n');
        if (ans !== 'y') {
            // "OK, so you don't die." (update_topl so it concatenates with the
            // monster-move messages that follow this turn), then savelife().
            // adjattrib(A_CON,-1,TRUE): no RNG (Con stays above its minimum) and
            // the status keeps showing the bonus-adjusted value, so leave the
            // displayed Con untouched.
            await d.update_topl("OK, so you don't die.");
            savelife(how);
            survive = true;
        }
    }

    if (!survive) {
        // C ref: end.c:1157 — `if (!program_state.panicking) done_object_cleanup()`,
        // run before disclosure and before bones are written.
        await done_object_cleanup();
        // C ref: end.c really_done(how) — the hero really dies.  Before the
        // disclosure/topten teardown, really_done computes
        //   bones_ok = (how < GENOCIDED) && can_make_bones();
        // (end.c:1201).  can_make_bones() draws a single rn2(1 + (depth>>2))
        // ("fewer ghosts on low levels"); on the Gnomish-Mines death level
        // (depth 3, depth>>2 == 0) that is rn2(1)=0, after which it returns
        // FALSE (no bones written — !wizard, and the harness has no bones file
        // anyway).  This one draw sits between the death blow and the next
        // segment's o_init shuffle, so emitting it keeps the RNG stream aligned
        // across the death boundary (seed0030 step-73).  savebones()/the actual
        // bones-file write is never reached here (bones_ok is FALSE).
        let bones_ok = false;
        if (how < GENOCIDED) {
            const { can_make_bones } = await import('./bones.js');
            bones_ok = can_make_bones();
        }
        // C ref: end.c:1238 really_done() — `taken = paybill((how == ESCAPED)
        // ? -1 : (how != QUIT), silently)`, immediately after the bones_ok
        // computation and before display_nhwindow(WIN_MESSAGE) pages the
        // "You die..." line.  An angry shopkeeper the hero died next to takes
        // everything, and that message shares the death topline.
        let taken = false;
        if (how !== PANICKED && !stopprint) {
            const { paybill } = await import('./shkroom.js');
            const before = game._pending_message;
            taken = !!await paybill(how === ESCAPED ? -1 : (how !== QUIT ? 1 : 0));
            // C ref: pline.c vpline() `if (u.ux) flush_screen(1)` ->
            // display.c:2236 `if (disp.botl || disp.botlx) bot()`.  done() has
            // just forced u.uhp to 0 and set disp.botl, so the shopkeeper's
            // "takes all your possessions" pline redraws the status with HP:0.
            if (game._pending_message !== before) { delete game._botlFrozen; d.freeze_botl(); }
        }

        game.program_state = game.program_state || {};
        game.program_state.gameover = true;

        if (stopprint) {
            // C ref: end.c disclose() — every one of its six category blocks
            // is gated on "!done_stopprint", so a 'q' answer to the wizard-
            // mode "Dump core?" query (set via done_stopprint++ in done2())
            // skips all of them outright; the tombstone is unreachable too
            // (outrip() requires how < GENOCIDED, and QUIT is 13).  What's
            // left is topten()'s wizard/discover branch: a bare score-skipped
            // notice, no table.
            await quit_final_message();
        } else {
            // C ref: end.c really_done() — the death tail.  This used to be
            // gated on `!wizard && !discover`, i.e. a wizard/explore hero who
            // answered 'y' to "Die?" got NO disclosure, NO tombstone and NO
            // score notice at all; C runs the identical really_done() for them
            // and only swaps topten()'s high-score table for the "score list
            // will not be checked" line (topten.c:725).  After the bones check,
            // display_nhwindow(WIN_MESSAGE, FALSE) pages the still-unseen
            // "You die..." top line with --More--, then disclose() offers its
            // six end-of-game queries before the tombstone/topten teardown.
            if (game._toplin === 1) { // display_nhwindow(WIN_MESSAGE): more()
                await d.topl_more();
                game._toplin = 0;
                game._pending_message = '';
            }
            // Acking that --More-- is where the deferred status redraw lands:
            // every frame from the first disclosure prompt on shows the zeroed
            // HP, while the "You die..." --More-- frames still show the value
            // done()'s own bot() left (nothing, when uhp was exactly -1).
            delete game._botlFrozen;
            // C ref: end.c really_done() — "needed for both inventory
            // disclosure and dumplog": for how != PANICKED, fully identify
            // every inventory object (discover_object + known/bknown/dknown/
            // rknown=1 + set_cknown_lknown) before disclose() runs, so its
            // 'i' listing shows true names/enchantments, not appearances.
            if (how !== PANICKED) {
                const invmod = await import('./invent.js');
                const inv = Array.isArray(game.invent) ? game.invent
                    : (Array.isArray(game.gi?.invent) ? game.gi.invent : []);
                for (const obj of inv) invmod.fully_identify_obj(obj);
            }
            const clean = await disclose(how, taken);
            // C ref: end.c:1363 — savebones() runs AFTER disclose(), i.e. after
            // the "You die..." --More-- has been paged; doing it earlier wiped
            // the map out from under those frames.
            if (bones_ok) {
                // C ref: end.c:1366 — `if (!wizard || paranoid_query(
                // ParanoidBones, "Save bones?")) savebones(...)`.  ParanoidBones
                // is off by default, so this is a plain yn() defaulting to 'n';
                // 'n' skips the bones file but the game still ends.
                let save_bones = true;
                if (wizard) save_bones = (await d.y_n('Save bones?', 'yn', 'n')) === 'y';
                if (save_bones) {
                    const corpse = await make_hero_corpse_and_grave(how);
                    const { savebones } = await import('./bones.js');
                    await savebones(how, corpse || game._death_corpse || null);
                }
            }
            if (clean) await real_death_epilogue(how, wizard || discover);
        }
    }
}

// C ref: topten.c topten() wizard/discover branch — reached once bones/
// disclose/tombstone are all unreachable (done_stopprint, how >= GENOCIDED):
// a blank line then "Since you were in wizard mode, the score list will not
// be checked." (no --More--, no table), and the game ends.
async function quit_final_message() {
    const disp = game?.nhDisplay;
    if (!disp?.putstr) {
        game.program_state = game.program_state || {};
        game.program_state.gameover = true;
        return;
    }
    const { nhgetch } = await import('./input.js');
    const NO_COLOR = 8; // terminal.js NO_COLOR
    const wizard = !!game.flags?.debug;
    disp.clearScreen();
    const msg = `Since you were in ${wizard ? 'wizard' : 'discover'} mode,`
        + ' the score list will not be checked.';
    disp.putstr(0, 1, msg, NO_COLOR, 0);
    // C ref: end.c really_done() tail — "if (done_stopprint) { raw_print("");
    // raw_print(""); }" right before nh_terminate(): two more blank-line
    // cursor advances (no visible text change) when quitting via 'q'.
    disp.setCursor(0, game._done_stopprint ? 4 : 2);
    game.program_state = game.program_state || {};
    game.program_state.gameover = true;
    await nhgetch();
}

// C ref: end.c done2() — the '#quit' command.  Confirms via paranoid_query
// (ParanoidQuit is off by default, so a plain "[yn] (n)" prompt), then in
// wizard mode offers ynq("Dump core?").  Declining the core dump either way
// falls through to done(QUIT); answering 'q' there sets done_stopprint,
// which done()/disclose() key off of to skip straight to the score-skipped
// notice.  The tutorial-abandon branch (no tutorial support in this port)
// and the 'y' core-dump branch (an immediate process abort with no further
// screens) aren't exercised by any recorded session.
export async function doquit() {
    const d = await deps();
    const ans = await d.y_n('Really quit without saving?', 'yn', 'n');
    if (ans !== 'y') {
        // C ref: end.c:105 — the declined arm opens with
        // clear_nhwindow(WIN_MESSAGE), so the prompt line is wiped rather than
        // left standing under the next command.
        game._pending_message = '';
        game._toplin = 0;
        if (d.flush_screen) await d.flush_screen(1);
        return 0; // ECMD_OK: declined, keep playing
    }

    const wizard = !!game.flags?.debug;
    if (wizard) {
        const c = await d.y_n('Dump core?', 'ynq', 'q');
        if (c === 'q') game._done_stopprint = (game._done_stopprint || 0) + 1;
    }
    await done(QUIT);
    return 0;
}

// C ref: flag.h:110-115 — the six values flags.end_disclose[] can hold.
const DISCLOSE_PROMPT_DEFAULT_YES = 'y';
const DISCLOSE_PROMPT_DEFAULT_NO = 'n';
const DISCLOSE_PROMPT_DEFAULT_SPECIAL = '?'; // v/g only: prompt, default 'a'
const DISCLOSE_YES_WITHOUT_PROMPT = '+';
const DISCLOSE_NO_WITHOUT_PROMPT = '-';
const DISCLOSE_SPECIAL_WITHOUT_PROMPT = '#'; // v/g only: no prompt, use 'a'
// C ref: decl.c:54 `const char disclosure_options[] = "iavgco";` — the array
// order is inventory, attributes, vanquished, genocided, conduct, overview.
const disclosure_options = 'iavgco';

// C ref: end.c:477 should_query_disclose_option(category, &defquery) — map one
// end_disclose[] setting to {prompt?, default answer}.  Any value outside the
// six DISCLOSE_* constants falls through C's final `else` to prompt-with-'n'.
function should_query_disclose_option(end_disclose, category) {
    const disclose = end_disclose[category];
    switch (disclose) {
    case DISCLOSE_YES_WITHOUT_PROMPT:     return { ask: false, defquery: 'y' };
    case DISCLOSE_SPECIAL_WITHOUT_PROMPT: return { ask: false, defquery: 'a' };
    case DISCLOSE_NO_WITHOUT_PROMPT:      return { ask: false, defquery: 'n' };
    case DISCLOSE_PROMPT_DEFAULT_YES:     return { ask: true, defquery: 'y' };
    case DISCLOSE_PROMPT_DEFAULT_SPECIAL: return { ask: true, defquery: 'a' };
    default:                              return { ask: true, defquery: 'n' };
    }
}

// C ref: options.c:1442 optfn_disclose() req == do_set — parse the `disclose:`
// rc value into flags.end_disclose[].  Ported as the real character walk rather
// than a lookup of the two spellings the public corpus happens to use
// (`-i -a -v -g -c -o` and `yi ya yv yg yc yo`), because every other
// combination — `+i`, `#v`, `?g`, `disclose:all`, `!disclose`, `ki` (killed ->
// vanquished), `di` (dungeon -> overview) — is equally legal in an rc file.
function parse_end_disclose() {
    // C ref: options.c:7211 initoptions_init() — every category starts at
    // DISCLOSE_PROMPT_DEFAULT_NO.
    const end_disclose = {};
    for (const c of disclosure_options) end_disclose[c] = DISCLOSE_PROMPT_DEFAULT_NO;
    const raw = game.flags?.disclose;
    if (raw === undefined || raw === null) return end_disclose; // option absent
    // C: `op = string_for_opt(opts, TRUE)` yields empty_optstr for a bare
    // `disclose` with no ':value'; `!disclose` arrives with negated set.  Our
    // rc parser turns both of those into a boolean, so recover them here —
    // String(false) would otherwise be scanned as the letters f/a/l/s/e and set
    // the 'a' category.
    let negated = false, op;
    if (raw === true) op = '';
    else if (raw === false) { op = ''; negated = true; }
    else op = String(raw);
    // C: "disclose" without a value means "all with prompting" and negated
    // means "none without prompting".
    if (op === '' || op.toLowerCase() === 'all' || op.toLowerCase() === 'none') {
        if (op !== '' && op.toLowerCase() === 'none') negated = true;
        for (const c of disclosure_options)
            end_disclose[c] = negated ? DISCLOSE_NO_WITHOUT_PROMPT
                                      : DISCLOSE_PROMPT_DEFAULT_YES;
        return end_disclose;
    }
    const valid_settings = DISCLOSE_PROMPT_DEFAULT_YES + DISCLOSE_PROMPT_DEFAULT_NO
        + DISCLOSE_PROMPT_DEFAULT_SPECIAL + DISCLOSE_YES_WITHOUT_PROMPT
        + DISCLOSE_NO_WITHOUT_PROMPT + DISCLOSE_SPECIAL_WITHOUT_PROMPT;
    let prefix_val = null;
    for (const ch of op) {
        let c = ch.toLowerCase(); // C: lowc(*op) — a prefix may be capitalised
        if (c === 'k') c = 'v'; // killed -> vanquished
        if (c === 'd') c = 'o'; // dungeon -> overview
        if (disclosure_options.includes(c)) {
            if (prefix_val !== null) {
                let pv = prefix_val;
                // The two 'a' (sort-order) settings only mean anything for the
                // vanquished/genocided lists; elsewhere they degrade to yes.
                if (c !== 'v' && c !== 'g') {
                    if (pv === DISCLOSE_PROMPT_DEFAULT_SPECIAL) pv = DISCLOSE_PROMPT_DEFAULT_YES;
                    if (pv === DISCLOSE_SPECIAL_WITHOUT_PROMPT) pv = DISCLOSE_YES_WITHOUT_PROMPT;
                }
                end_disclose[c] = pv;
                prefix_val = null;
            } else {
                // "For backward compatibility, no prefix is required, and the
                // presence of a i,a,g,v, or c without a prefix sets the
                // corresponding value to DISCLOSE_YES_WITHOUT_PROMPT."
                end_disclose[c] = DISCLOSE_YES_WITHOUT_PROMPT;
            }
        } else if (valid_settings.includes(c)) {
            prefix_val = c;
        } else if (c === ' ') {
            /* do nothing */
        } else {
            // C: config_error_add("Unknown disclose parameter '%c'") then
            // `return optn_err` — the rest of the value is never scanned, but
            // the settings applied so far stand.
            break;
        }
    }
    return end_disclose;
}

// C ref: end.c:620 disclose(how, taken) — the six end-of-game disclosure
// queries, in disclosure_options order (i, a, v, g, c, o).  Content renderers:
// 'i' -> invent.js display_inventory_interactive(); 'a'/'c' -> insight.js
// show_attributes_disclosure()/show_conduct_disclosure(); 'v' -> insight.js
// list_vanquished_screen(); 'o' -> extcmd-handlers.js
// show_overview_disclosure().  Every block is gated on !done_stopprint, which a
// 'q' answer sets — so 'q' suppresses the remaining queries AND (back in
// really_done) the tombstone window and the score list; returning `false` is how
// that reaches the caller.
async function disclose(how, taken = false) {
    const d = await deps();
    const end_disclose = parse_end_disclose();
    const inv = Array.isArray(game.invent) ? game.invent
        : (Array.isArray(game.gi?.invent) ? game.gi.invent : []);
    const final = (how >= PANICKED) ? 1 : 2; // ENL_GAMEOVERALIVE : ENL_GAMEOVERDEAD
    // C ref: decl.c ynqchars = "ynq"; tty_yn_function also always accepts ESC.
    const ynqchars = 'ynq\x1b';
    let stopprint = false;

    async function query(category, qbuf) {
        const { ask, defquery } = should_query_disclose_option(end_disclose, category);
        return ask ? await d.y_n(qbuf, ynqchars, defquery) : defquery;
    }

    if (inv.length) {
        // C ref: end.c:626 — when a shopkeeper confiscated everything before the
        // hero died (paybill() returned TRUE), the question is about what they
        // HAD rather than about identifying what they still carry.
        const qbuf = taken
            ? `Do you want to see what you had when you ${(how === QUIT) ? 'quit' : 'died'}?`
            : 'Do you want your possessions identified?';
        const c = await query('i', qbuf);
        if (c === 'y') {
            const invmod = await import('./invent.js');
            await invmod.display_inventory_interactive(null);
            // C ref: end.c:641 `container_contents(gi.invent, TRUE, TRUE,
            // FALSE)` — one "Contents of the <box>:" window per carried
            // container, recursing into nested ones.  Not ported: reachable only
            // for a hero who both carries a container and answers 'y' here.
        }
        if (c === 'q') stopprint = true;
    }

    if (!stopprint) {
        const c = await query('a', 'Do you want to see your attributes?');
        if (c === 'y') {
            const { show_attributes_disclosure } = await import('./insight.js');
            await show_attributes_disclosure(final);
        }
        if (c === 'q') stopprint = true;
    }

    const insight = await import('./insight.js');
    if (!stopprint) {
        // C ref: insight.c:2826 list_vanquished(defquery, ask) — the prompt only
        // exists when some species has died.  ntypes > 1 widens the answer set to
        // ynaqchars ("[ynaq]"); with exactly one type 'a' is accepted but not
        // advertised, and a defquery of 'a' (from `disclose:#v` / `?v`) is
        // demoted to 'y' because there is nothing to sort.
        const ntypes = insight.vanquished_ntypes();
        if (ntypes > 0) {
            const q = should_query_disclose_option(end_disclose, 'v');
            let defquery = q.defquery;
            const resp = (ntypes > 1) ? 'ynaq\x1b' : 'ynq\x1b a';
            if (ntypes <= 1 && defquery === 'a') defquery = 'y';
            const c = q.ask
                ? await d.y_n('Do you want an account of creatures vanquished?', resp, defquery)
                : defquery;
            if (c === 'q') stopprint = true;
            // 'a' with more than one type first asks for a sort order via
            // set_vanq_order(); only the default VANQ_MLVL_MNDX ordering is
            // ported, so both answers render the same list.
            if (c === 'y' || c === 'a') await insight.list_vanquished_screen();
        }
    }
    if (!stopprint) {
        // C ref: insight.c:3007 list_genocided(defquery, ask) — at end of game
        // `both` is TRUE (program_state.gameover), so extinct species count too.
        // With nothing gone there is no prompt at all.
        const { ngenocided, nextinct, ngone } = genocided_counts();
        if (ngone > 0) {
            const q = should_query_disclose_option(end_disclose, 'g');
            let defquery = q.defquery;
            const qbuf = `Do you want a list of ${(nextinct && !ngenocided) ? 'extinct ' : ''}species`
                + `${ngenocided ? ' genocided' : ''}${(nextinct && ngenocided) ? ' and extinct' : ''}?`;
            const resp = (ngone > 1) ? 'ynaq\x1b' : 'ynq\x1b a';
            const c = q.ask ? await d.y_n(qbuf, resp, defquery) : defquery;
            if (c === 'q') stopprint = true;
            // The "Genocided species:" window itself is unported (insight.js
            // dogenocided() is the other caller and is a stub); reachable only
            // after an actual genocide or a species hitting its birth limit.
        }
    }

    if (!stopprint) {
        // C ref: end.c:670 — the question gains " and achievements" whenever
        // count_achievements() > 0 (u.uachieved is non-empty).
        const acnt = Array.isArray(game.u?.uachieved) ? game.u.uachieved.length : 0;
        const c = await query('c',
            `Do you want to see your conduct${(acnt > 0) ? ' and achievements' : ''}?`);
        if (c === 'y') {
            await insight.show_conduct_disclosure(final);
        }
        if (c === 'q') stopprint = true;
    }

    if (!stopprint) {
        const c = await query('o', 'Do you want to see the dungeon overview?');
        if (c === 'y') {
            const { show_overview_disclosure } = await import('./extcmd-handlers.js');
            await show_overview_disclosure(final, how);
        }
        if (c === 'q') stopprint = true;
    }

    if (stopprint) game._done_stopprint = (game._done_stopprint || 0) + 1;
    return !stopprint;
}

// C ref: insight.c num_genocides()/num_extinct()/num_gone(mvflags, mindx) — the
// three counts list_genocided() decides its prompt wording from.  mvitals[]
// carries G_GENOD / G_EXTINCT per species; a species can be both.
function genocided_counts() {
    const mv = game.mvitals || [];
    let ngenocided = 0, nextinct = 0, ngone = 0;
    for (let i = 0; i < mv.length; i++) {
        const f = mv[i]?.mvflags | 0;
        if (f & G_GENOD) ngenocided++;
        if (f & G_EXTINCT) nextinct++;
        if (f & (G_GENOD | G_EXTINCT)) ngone++;
    }
    return { ngenocided, nextinct, ngone };
}

// C ref: end.c really_done() tail for a normal (non-wizard, non-discover)
// death: outrip() renders the tombstone into a TEXT window whose teardown
// pages two more blank --More-- acknowledgements, then topten() reports the
// score.  The scores "record" file is always empty in this harness (no
// state persists a real high-score list), so the just-died entry is always
// rank 1 ("You made the top ten list!"); other rank0/skip_scores branches
// of topten() are not reachable here.
// `scoreSkipped` == (wizard || discover): topten() then prints the "score list
// will not be checked" notice in place of the high-score table (topten.c:725)
// and the 'record' file is left alone.
async function real_death_epilogue(how, scoreSkipped = false) {
    const disp = game?.nhDisplay;
    const { nhgetch } = await import('./input.js');
    if (!disp?.putstr) return;
    const { genl_outrip } = await import('./rip.js');
    const { roles, races, genders, aligns } = await import('./role.js');
    const u = game.u;
    const NO_COLOR = 8;
    const ATR_BOLD = 2;
    const ROWS = 24;
    const COLNO = 80;

    const plname = game.plname || game.svp?.plname || 'wizard';
    const female = !!game.flags?.female;
    const roleName = (female && game.urole?.name?.f)
        ? game.urole.name.f
        : (game.urole?.name?.m || 'Adventurer');
    const inv = Array.isArray(game.invent) ? game.invent
        : (Array.isArray(game.gi?.invent) ? game.gi.invent : []);
    const umoney = money_toplevel(inv) + hidden_gold_inv(inv);

    const uz = u?.uz || { dnum: 0, dlevel: 1 };
    const dungeonName = game.dungeons?.[uz.dnum]?.dname || 'The Dungeons of Doom';
    // deepest_lev_reached(FALSE) approximated by the current depth (matches
    // outrip_and_score's own simplification for these single-descent deaths).
    const depth = (game.dungeons?.[uz.dnum]?.depth_start ?? 1) + (uz.dlevel | 0) - 1;

    const deepest2 = deepest_lev_reached_js(false) || depth;
    let tmp = umoney - (u?.umoney0 || 0);
    if (tmp < 0) tmp = 0;
    if (how < PANICKED) tmp -= Math.trunc(tmp / 10);
    tmp += 50 * (deepest2 - 1);
    if (deepest2 > 20) tmp += 1000 * ((deepest2 > 30) ? 10 : deepest2 - 20);
    const urexp = (u?.urexp || 0) + tmp;
    u.urexp = urexp; // really_done() persists this before topten() reads it

    const deathText = game._killer_name || DEATHS[how] || 'died';
    const year = (+String(game.datetime || '').slice(0, 4)) || 2020;
    const moves = (game.moves == null ? 0 : (game.moves | 0));

    const lines = [];
    // Stone only for a death (how <= GENOCIDED); see outrip_and_score().
    const stone = how <= GENOCIDED;
    if (stone) {
        lines.push('');
        for (const r of genl_outrip(plname, umoney, deathText, year)) lines.push(r);
        lines.push('');
        lines.push('');
    }
    lines.push(`${goodbye_for_role(roleName)} ${plname} the ${roleName}...`);
    lines.push('');
    lines.push((how !== ESCAPED && how !== ASCENDED)
        ? `You ${ENDS[how]} in ${dungeonName} on dungeon level ${depth}`
          + ` with ${urexp} point${plur(urexp)},`
        : `You ${how === ASCENDED ? 'went to your reward' : 'escaped from the dungeon'}`
          + ` with ${urexp} point${plur(urexp)},`);
    lines.push(`and ${umoney} piece${plur(umoney)} of gold, after ${moves} move${plur(moves)}.`);
    lines.push(`You were level ${u?.ulevel || 1} with a maximum of ${u?.uhpmax || 0}`
        + ` hit point${plur(u?.uhpmax || 0)} when you ${ENDS[how]}.`);
    lines.push('');

    const MORE = '--More--';
    const drawMore = (row) => {
        for (let i = 0; i < MORE.length; i++) disp.setCell(i, row, MORE[i], NO_COLOR, 0);
        disp.setCursor(MORE.length, row);
    };

    // C ref: getline.c xwaitforspace(quitchars) behind every dmore() — only
    // " \r\n\033" dismiss; any other key rings the bell and waits again without
    // redrawing, so it records as a repeat of the same frame.
    const waitforspace = async () => {
        for (;;) {
            const k = await nhgetch();
            if (k === 32 || k === 13 || k === 10 || k === 27) return k;
        }
    };

    // C ref: wintty.c process_text_window() — the endgame TEXT window is paged
    // 23 lines at a time with --More-- on row 23 of EVERY page (including the
    // last).  A death's text is exactly 24 lines (blank + 15 rip rows + 2 blank
    // + goodbye + blank + 3 summary + trailing blank), so it pages as a full
    // page then a blank one; a QUIT's is 6 lines -> a single page.
    const PAGE = ROWS - 1;
    const npages = Math.max(1, Math.ceil(lines.length / PAGE));
    let ripCancelled = false;
    for (let p = 0; p < npages && !ripCancelled; p++) {
        disp.clearScreen();
        for (let i = 0; i < PAGE; i++) {
            const t = lines[p * PAGE + i];
            if (t) disp.putstr(0, i, t, NO_COLOR, 0);
        }
        drawMore(ROWS - 1);
        ripCancelled = (await waitforspace()) === 27;
    }

    // C ref: topten() — "assure minimum number of points": t0->points is
    // floored to 0 when under sysopt.pointsmin (always 1: POINTSMIN's
    // config-file floor is max(POINTSMIN,1)).
    const scorePoints = urexp < 1 ? 0 : urexp;

    // topten() real (non-wizard) output.
    if (scoreSkipped) {
        // C ref: topten.c:725 — `if (wizard || discover) { if (how != PANICKED)
        // { topten_print(""); topten_print("Since you were in %s mode, the score
        // list will not be checked."); } goto showwin; }`.  No table, no record
        // update, and the window is still displayed.
        disp.clearScreen();
        if (how !== PANICKED) {
            const msg = `Since you were in ${is_wizard() ? 'wizard' : 'discover'} mode,`
                + ' the score list will not be checked.';
            disp.putstr(0, 1, msg, NO_COLOR, 0);
            disp.setCursor(0, 2);
        } else {
            disp.setCursor(0, 0);
        }
        game.program_state = game.program_state || {};
        game.program_state.gameover = true;
        const q = game?.nhDisplay;
        while ((q?.inputQueueLength ?? 0) > 0) await nhgetch();
        await nhgetch();
        return;
    }
    const roleFC = roles[game.initrole]?.filecode || '?';
    const raceFC = races[game.initrace]?.filecode || '?';
    const genderFC = genders[female ? 1 : 0]?.filecode || '?';
    const alignFC = aligns.find(a => a.value === (u?.ualign?.type ?? 0))?.filecode || '?';
    const entry = {
        points: scorePoints, name: plname, plrole: roleFC, plrace: raceFC,
        plgend: genderFC, plalign: alignFC, death: deathText, dungeonName,
        deathdnum: uz.dnum, knoxDnum: -99, // Fort Ludios unreachable here
        deathlev: depth, maxlvl: depth, hp: u?.uhp ?? 0, maxhp: u?.uhpmax ?? 0,
        urexp,
    };
    const tt = topten_list(entry);

    // Blank --More-- acknowledgements (endwin teardown): two when the entry
    // makes the list (each of seed0030's diverse deaths scores real points and
    // gets the "You made the top ten list!" banner), one when it doesn't
    // (seed0009's Tutorial death, floored to 0 points; seed0030's Samurai quit).
    // (blank trailing page handled by the pager above)

    disp.clearScreen();
    let row = 0;
    const printLine = (text, so) => {
        disp.putstr(0, row++, text, NO_COLOR, so ? ATR_BOLD : 0);
    };
    printLine('', false);              // C: HUP topten_print("") before the list
    if (tt.notbeaten) { printLine(tt.notbeaten, false); printLine('', false); }
    if (tt.banner) { printLine(tt.banner, false); printLine('', false); }
    printLine(topten_outheader(COLNO), false);
    for (const e of tt.shown) {
        if (e.blank) { printLine('', false); continue; }
        for (const l of topten_outentry(e.rank, e.entry, e.so, COLNO))
            printLine(l, e.so);
    }
    disp.setCursor(0, row);
    topten_record_write(tt);

    game.program_state = game.program_state || {};
    game.program_state.gameover = true;
    // C nh_terminate()s here, so a real session simply stops consuming keys.
    // A replayed one must not: this port's post-death UI is shorter than C's
    // (the disclosure prompts are unported), so a hero who dies EARLIER than
    // the recorded one leaves keys queued.  Segments of one session share a
    // single flattened screen index, so those unread keys shift every later
    // segment out of alignment.  Draining them holds the alignment; the
    // trailing frames themselves can't match content until the missing
    // prompts are ported.  Bounded by the replay queue rather than by
    // nhgetch()'s end-of-input throw, so an interactive session (queue empty,
    // refilled only by a real keypress) still stops at the single read here
    // instead of swallowing every key the player presses afterwards.
    const replayq = game?.nhDisplay;
    while ((replayq?.inputQueueLength ?? 0) > 0) await nhgetch();
    await nhgetch();
}

// ── the persistent 'record' (high-score) file ──
//
// C ref: topten.c topten().  RECORD survives from one game to the next, so in a
// multi-segment session every death after the first prints the WHOLE accumulated
// list, not just the fresh entry.  The harness shares one Web-Storage handle
// across a session's segments (frozen/score.sh: "storage ... makes save/restore
// + bones persist across segments"), which is what stands in for that file here.
const RECORD_KEY = 'nethack.record';
// sysopt: sys.c:66-69 clamps the config.h values.  PERS_IS_UID is 1 on unix, and
// every segment of a session runs as the same uid, so the "same person" half of
// the PERSMAX test is always TRUE and only the role filecode distinguishes.
const PERSMAX = 3, ENTRYMAX = 100, POINTSMIN = 1;
// options.c:7170-7172 defaults.
const END_TOP = 3, END_AROUND = 2, END_OWN = false;

function topten_record_read() {
    const storage = game.storage;
    if (!storage || typeof storage.getItem !== 'function') return [];
    try {
        const blob = storage.getItem(RECORD_KEY);
        const arr = blob ? JSON.parse(blob) : null;
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

// C: the record file is rewritten (with the merged list) only when flg was set,
// i.e. only when this game's entry was inserted or an over-PERSMAX entry dropped.
function topten_record_write(tt) {
    const storage = game.storage;
    if (!tt.flg || !storage || typeof storage.setItem !== 'function') return;
    try { storage.setItem(RECORD_KEY, JSON.stringify(tt.list)); } catch { /*noop*/ }
}

// C ref: hacklib.c ordin(n).
function ordin(n) {
    const dd = n % 10;
    return (dd === 0 || dd > 3 || Math.trunc((n % 100) / 10) === 1) ? 'th'
         : (dd === 1 ? 'st' : dd === 2 ? 'nd' : 'rd');
}

// C ref: topten.c topten() — merge t0 into the record list, decide rank0 and
// which entries get displayed.  Returns { list, shown, banner, notbeaten, flg }.
function topten_list(t0) {
    const stored = topten_record_read();
    const list = [];
    let rank = 1, occ_cnt = PERSMAX, rank0 = -1, rank1 = 0, flg = 0;
    let notbeaten = null;
    for (let i = 0; ; i++) {
        // i >= stored.length is the zero-points sentinel a short record file
        // reads back as (readentry() at EOF).
        const src = i < stored.length ? stored[i] : null;
        const pts = src ? (src.points < POINTSMIN ? 0 : src.points) : 0;
        if (rank0 < 0 && pts < t0.points) {
            rank0 = rank++;
            list.push(t0);
            occ_cnt--;
            flg++;
        }
        if (pts === 0) break;
        const t1 = { ...src, points: pts };
        if (t1.plrole === t0.plrole && --occ_cnt <= 0) {
            if (rank0 < 0) {
                rank0 = 0;
                rank1 = rank;
                notbeaten = `You didn't beat your previous score of ${pts} points.`;
            }
            // occ_cnt < 0: this entry is over the per-person limit, so it is
            // dropped from the rewritten file (C reuses the node and continues).
            if (occ_cnt < 0) { flg++; continue; }
        }
        list.push(t1);
        if (rank <= ENTRYMAX) rank++;
        if (rank > ENTRYMAX) break;
    }

    let banner = null;
    if (flg && rank0 > 0) {
        banner = rank0 <= 10
            ? 'You made the top ten list!'
            : `You reached the ${rank0}${ordin(rank0)} place on the top ${ENTRYMAX} list.`;
    }
    if (rank0 === 0) rank0 = rank1;
    if (rank0 <= 0) rank0 = rank;

    // skip_scores is FALSE with the default end_top=3.
    const shown = [];
    for (let i = 0; i < list.length; i++) {
        const r = i + 1;
        if (!(r <= END_TOP
              || (r >= rank0 - END_AROUND && r <= rank0 + END_AROUND)
              || (END_OWN && list[i].name === t0.name))) continue;
        if (r === rank0 - END_AROUND && rank0 > END_TOP + END_AROUND + 1 && !END_OWN)
            shown.push({ rank: -1, entry: null, so: false, blank: true });
        if (r !== rank0) shown.push({ rank: r, entry: list[i], so: false });
        else if (!rank1) shown.push({ rank: r, entry: list[i], so: true });
        else {
            shown.push({ rank: r, entry: list[i], so: true });
            shown.push({ rank: 0, entry: t0, so: true });
        }
    }
    // C: "if (rank0 >= rank) outentry(0, t0, TRUE)" — this game's entry did not
    // make the list (or fell past its end), so it is appended rankless.
    if (rank0 >= rank) shown.push({ rank: 0, entry: t0, so: true });
    return { list, shown, banner, notbeaten, flg };
}

// C ref: topten.c outheader() — the column header line, padded so "Hp [max]"
// lands flush against the right edge (COLNO - 9 == where the padding stops).
function topten_outheader(COLNO) {
    let line = ' No  Points     Name';
    while (line.length < COLNO - 9) line += ' ';
    line += 'Hp [max]';
    return line;
}

// C ref: topten.c outentry(rank, t1, so) — format one score-list entry,
// word-wrapping across as many lines as needed so the "Hp [max]" column
// stays aligned at the right edge.  Reduced to the death-description branches
// reachable by a plain "died in <dungeon> [on level N]" contest death
// (escaped/ascended/starved/choked/poisoned/crushed/petrified and the
// astral-plane wording are not reachable here).  `so` (standout) pads each
// line to COLNO-1 for the bold render, matching the just-died entry.
function topten_outentry(rank, entry, so, COLNO) {
    let linebuf = rank ? String(rank).padStart(3) : '   ';
    // C: "%10ld", t1->points ? t1->points : u.urexp — a points-floored-to-0
    // entry still shows the raw score it would have had.
    const pts = entry.points ? entry.points : (entry.urexp || 0);
    linebuf += ` ${String(pts).padStart(10)}  ${entry.name.slice(0, 10)}`;
    linebuf += `-${entry.plrole}`;
    if (entry.plrace !== '?') linebuf += `-${entry.plrace}`;
    linebuf += `-${entry.plgend}`;
    if (entry.plalign !== '?') linebuf += `-${entry.plalign} `;
    else linebuf += ' ';

    let secondLine = true;
    const death = entry.death;
    if (death.startsWith('quit')) { linebuf += 'quit'; secondLine = false; }
    else if (death.startsWith('died of st')) { linebuf += 'starved to death'; secondLine = false; }
    else if (death.startsWith('choked')) linebuf += `choked on h${entry.plgend[0] === 'F' ? 'er' : 'is'} food`;
    else if (death.startsWith('poisoned')) linebuf += 'was poisoned';
    else if (death.startsWith('crushed')) linebuf += 'was crushed to death';
    else if (death.startsWith('petrified by ')) linebuf += 'turned to stone';
    else linebuf += 'died';
    // C: svd.dungeons[t1->deathdnum].dname — resolved against the CURRENT game's
    // dungeon table, so a record entry written by an earlier game re-reads it.
    const dname = game.dungeons?.[entry.deathdnum]?.dname || entry.dungeonName;
    linebuf += ` in ${dname}`;
    if (entry.deathdnum !== entry.knoxDnum) linebuf += ` on level ${entry.deathlev}`;
    if (entry.deathlev !== entry.maxlvl) linebuf += ` [max ${entry.maxlvl}]`;
    if (death.startsWith('quit ')) linebuf += death.slice(4);
    linebuf += '.';

    if (secondLine) {
        const d0 = death.charAt(0).toUpperCase() + death.slice(1);
        linebuf += `  ${d0}.`;
        linebuf = linebuf.replace('; the ', ', the ');
    }

    const printed = [];
    let lngr = linebuf.length;
    const hppos0 = COLNO - 10; // sizeof "  Hp [max]" - sizeof ""
    while (lngr >= hppos0) {
        let bp = linebuf.length;
        while (!(bp < linebuf.length && linebuf[bp] === ' ' && bp < hppos0)) {
            bp--;
            if (bp < 0) break;
        }
        if (15 >= bp) bp = hppos0 - 1;
        if (bp > 5 && linebuf.slice(bp - 5, bp) === ' [max') bp -= 5;
        const carry = linebuf[bp] !== ' ' ? linebuf.slice(bp) : linebuf.slice(bp + 1);
        printed.push(linebuf.slice(0, bp));
        linebuf = `${' '.repeat(15)} ${carry}`;
        lngr = linebuf.length;
    }

    const hpbuf = entry.hp <= 0 ? '-' : String(entry.hp);
    const hppos = COLNO - 7 - hpbuf.length;
    if (linebuf.length <= hppos) {
        while (linebuf.length < hppos) linebuf += ' ';
        linebuf += hpbuf;
        const pad = entry.maxhp < 10 ? '  ' : entry.maxhp < 100 ? ' ' : '';
        linebuf += ` ${pad}[${entry.maxhp}]`;
    }
    printed.push(linebuf);

    if (!so) return printed;
    return printed.map((t) => {
        let s = t;
        while (s.length < COLNO - 1) s += ' ';
        return s;
    });
}

// C ref: hack.h an(str) — indefinite article.
function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }

// C ref: end.c done_in_by() killer-name construction, reduced to the common
// case: an ordinary (non-unique, non-ghost, non-shopkeeper, non-priest,
// non-shapeshifted) monster.  monhealthdescr() is a no-op in this NetHack
// version (pager.c:140-161, disabled behind `#if 0`), so no health descriptor
// is ever prepended.  killer.format is KILLED_BY_AN, giving "killed by a
// <species>" — used for both the tombstone engraving and the topten entry.
function killer_text_for_monster(mtmp) {
    // C ref: end.c:264-271 — a shopkeeper killer gets an honorific and NO
    // article (killer.format = KILLED_BY).  formatkiller() (topten.c:137) then
    // rewrites every ',' in the stored name to ';'; outentry() reverses it for
    // the on-screen topten table only (js/end.js:856), so the stored form must
    // carry the semicolon or the tombstone's word wrap comes out wrong.
    if (mtmp?.isshk) {
        const shknm = shk_name_for_killer(mtmp);
        // shkname_is_pname(): ESHK(mtmp)->shknam[0] == '_' (a proper name, no
        // honorific) — shknms[] marks those with a leading underscore.
        const raw = mtmp.eshk?.shknam || '';
        const honorific = raw[0] === '_' ? '' : (mtmp.female ? 'Ms. ' : 'Mr. ');
        return `killed by ${honorific}${shknm}; the shopkeeper`;
    }
    const name = mtmp?.data?.name || 'monster';
    return `killed by ${an(name)}`;
}
// shkroom.js imports end.js, so resolve shkname() lazily through the game state
// the caller already has rather than adding a static cycle.
function shk_name_for_killer(mtmp) {
    const nm = mtmp.eshk?.shknam;
    if (!nm) return mtmp.data?.name || 'shopkeeper';
    return /[A-Za-z]/.test(nm[0]) ? nm : nm.slice(1);
}

// C ref: end.c done_in_by(mtmp, how) — a monster killed the hero.  Announces
// "You die..." then runs done(how).
export async function done_in_by(mtmp, how = DIED) {
    const d = await deps();
    // C ref end.c:195 — You((how == STONING) ? "turn to stone..." : "die...").
    await d.update_topl('You die...');
    game._killer_mon = mtmp || null;
    if (mtmp) game._killer_name = killer_text_for_monster(mtmp);
    await done(how);
}

export { done, savelife, DIED, ESCAPED };

// ═════════════════════════════════════════════════════════════════════════════
// INERT TRANSLATIONS of src/end.c — functions this file had no counterpart for.
//
// Nothing below is called from existing code.  They exist so a later, MEASURED
// pass can wire them up one call site at a time: reordering RNG draws forfeits
// every screen after the reorder, so translation and wiring are separate waves.
// Each keeps the C name, C control flow, and C order of operations (which is
// what fixes the draw order for whoever wires it up).
//
// TWO end.c symbols are NOT here because they are already ported under other
// names — a second copy would be the duplicate-reimplementation trap:
//   done2()      -> doquit() above (same body: paranoid_query "Really quit
//                   without saving?", wizard ynq "Dump core?", done(QUIT)).
//   really_done() -> folded into done()'s `if (!survive)` block above, plus
//                   real_death_epilogue() / outrip_and_score().
// ═════════════════════════════════════════════════════════════════════════════

// C ref: const.js has these but end.js only imports the two mvflags bits; pull
// in the rest separately rather than editing the existing import line.
import { ismnum as ismnum_, TIMEOUT as TIMEOUT_ } from './const.js';
import { rn2 as rn2_ } from './rng.js';
import {
    objects as objects_, AMULET_CLASS as AMULET_CLASS_, GEM_CLASS as GEM_CLASS_,
    FIRST_REAL_GEM as FIRST_REAL_GEM_, LAST_REAL_GEM as LAST_REAL_GEM_,
    STATUE as STATUE_, BAG_OF_TRICKS as BAG_OF_TRICKS_, POT_WATER as POT_WATER_,
    AMULET_OF_YENDOR as AMULET_OF_YENDOR_,
} from './mkobj.js';

// hack.h:484-495 death codes end.js did not already name.
const CHOKING = 1, POISONING = 2, STARVING = 3, DROWNING = 4;
const STONING = 8, TURNED_SLIME = 9, TRICKED = 12;
// hack.h:602-604 killer.format.
const KILLED_BY_AN = 0, KILLED_BY = 1, NO_KILLER_PREFIX = 2;
// objects.h markers: MARKER(FIRST_AMULET, AMULET_OF_ESP) = 201,
// MARKER(LAST_AMULET, AMULET_OF_YENDOR) = 213,
// MARKER(LAST_GLASS_GEM, WORTHLESS_VIOLET_GLASS) = 469.
const FIRST_AMULET = 201, LAST_AMULET = AMULET_OF_YENDOR_, LAST_GLASS_GEM = 469;
// objects.h otyps artifact_score() scores alongside the real artifacts.
const BELL_OF_OPENING = 263, CANDELABRUM_OF_INVOCATION = 262,
      SPE_BOOK_OF_THE_DEAD = 409;
// potion otyp used by fuzzer_savelife()'s restore-ability remedy.
const POT_RESTORE_ABILITY = 298;
// objclass.h F_UNIQUE (mirrors the non-exported js/mkobj.js:173).
const F_UNIQUE = 64;
// flag.h:240 `fuzzer_off` — first value of the debug_fuzzer enum.
const fuzzer_off = 0;
// config.h:737 DUMPLOG_MSG_COUNT, and the build flag itself: the recorder's
// config.h leaves `#define DUMPLOG` commented out (line 669), so dumplog is
// compiled OUT and dump_everything() reduces to nhUse(how); nhUse(when).
const DUMPLOG = false;
const DUMPLOG_MSG_COUNT = 50;

// ── local stand-ins for helpers this port keeps private in other files ──

// C ref: hack.h isspace() as used by wordcount()/bel_copy1().
function isspace_(ch) { return ch === ' ' || ch === '\t' || ch === '\n'
                             || ch === '\v' || ch === '\f' || ch === '\r'; }

// C ref: hacklib.c nowrap_add(a, i) — saturating add used for u.urexp so a
// huge score cannot wrap negative.
function nowrap_add(a, i) {
    a = a | 0 ? a : (a || 0);
    return (a + i < 0) ? Number.MAX_SAFE_INTEGER : a + i;
}

// C ref: potion.c:75 set_itimeout(&which, val) — `*which &= ~TIMEOUT;
// *which |= itimeout(val)`.  js/ has no set_itimeout(); the pattern is inlined
// at its call sites (js/invent.js:3809).  Named with the trailing underscore so
// this end.c lane does not claim potion.c coverage for a private helper.
function set_itimeout_(cur, val) {
    return ((cur | 0) & ~TIMEOUT_) | Math.min(val, TIMEOUT_);
}

// C ref: objnam.c the_unique_obj(obj).  js/invent.js:8468 holds the same
// predicate but does not export it; oc_unique is `flags & F_UNIQUE` here
// (js/mkobj.js:1190), and this port populates F_UNIQUE for only a few otyps.
function the_unique_obj(obj) {
    if (!obj) return false;
    if (obj.dknown != null && !obj.dknown) return false;
    return !!(objects_[obj.otyp]?.flags & F_UNIQUE)
        && (!!obj.known || obj.otyp === AMULET_OF_YENDOR_);
}

// C ref: objects.h OBJ_NAME(objects[otyp]).
function OBJ_NAME(o) { return o?.name || ''; }

// C ref: obj.h Has_contents / Is_container / SchroedingersBox.  js/invent.js
// (372/378) and js/pickup.js:154 keep private copies of these; end.js has none.
function Has_contents(obj) { return !!(obj?.cobj && obj.cobj.length); }
function Is_container(obj) {
    const oc = objects_[obj?.otyp]?.oclass;
    return oc === 6 /* TOOL_CLASS */ && CONTAINER_OTYPS.has(obj.otyp);
}
// obj.h: BAG_OF_HOLDING..ICE_BOX plus the two chests/boxes and the sack family.
const CONTAINER_OTYPS = new Set([
    216 /* large box */, 217 /* chest */, 218 /* ice box */, 219 /* sack */,
    BAG_OF_TRICKS_, 221 /* bag of holding */, 222 /* oilskin sack */,
]);
// C ref: obj.h SchroedingersBox(o) — a large box with spe==1 made by the
// bones/quantum-mechanic path; mirrors js/pickup.js:154.
function SchroedingersBox(obj) { return !!obj && obj.otyp === 216 && obj.spe === 1; }

// C ref: objnam.c the()/upstart()/thesimpleoname() — private in js/pickup.js
// (189/202) and js/do_name.js:411.
function the_(s) { return /^[A-Z]/.test(s || '') ? s : `the ${s}`; }
function upstart(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// C ref: win/tty/wintty.c create_nhwindow/putstr/display_nhwindow/
// destroy_nhwindow.  frozen/terminal.js owns the real grid and coverage.mjs
// marks windows.c/wintty.c N/A, so these are text sinks: the translated
// functions accumulate their lines, and the wiring pass hands them to the
// existing renderer (js/extcmd-handlers.js render_container_contents() already
// does exactly that for container_contents(box, FALSE, FALSE, TRUE)).
function create_nhwindow(type) { return { type, lines: [] }; }
function putstr(win, _attr, str) {
    if (win && Array.isArray(win.lines)) win.lines.push(str);
}
function display_nhwindow(_win, _blocking) { /* wiring pass renders win.lines */ }
function destroy_nhwindow(_win) { }

// C ref: allmain.c gh.hero_seq == (svm.moves << 3) + hero moves this turn;
// mirrors the private js/apply.js:213.  gd.done_seq lives on the game state.
function hero_seq() { return ((game.moves | 0) << 3); }

// ── done1 / done_intr / done_hangup: the signal entry points ────────────────

// C ref: end.c:68 done1(sig) — the SIGINT handler and the keyboard-interrupt
// route into done2().  There are no POSIX signals in the replay harness, so the
// signal() calls have no counterpart; everything else translates.
export async function done1(_sig_unused) {
    // (void) signal(SIGINT, SIG_IGN);
    const iflags = game.iflags || (game.iflags = {});
    iflags.debug_fuzzer = fuzzer_off;
    if (game.flags?.ignintr) {
        // (void) signal(SIGINT, done1);
        const d = await deps();
        // clear_nhwindow(WIN_MESSAGE) — same mapping doquit()'s declined arm uses.
        game._pending_message = '';
        game._toplin = 0;
        // curs_on_u(); wait_synch();
        if (d.flush_screen) await d.flush_screen(1);
        if ((game.multi | 0) > 0) {
            const { nomul } = await import('./hack.js');
            nomul(0);
        }
    } else {
        await doquit(); // C: (void) done2()
    }
}

// C ref: end.c:154 done_intr(sig) — SIGINT during the endgame teardown: stop
// printing the rest of it, then ignore further SIGINT/SIGQUIT.
export function done_intr(_sig_unused) {
    game._done_stopprint = (game._done_stopprint || 0) + 1; // done_stopprint++
    // (void) signal(SIGINT, SIG_IGN); (void) signal(SIGQUIT, SIG_IGN);
}

// C ref: end.c:169 done_hangup(sig) — SIGHUP: note the hangup, disarm the
// handler, then fall into done_intr().
export function done_hangup(sig) {
    const ps = game.program_state || (game.program_state = {});
    ps.done_hup = (ps.done_hup || 0) + 1;
    // sethanguphandler(SIG_IGN);
    done_intr(sig);
}

// ── fixup_death ─────────────────────────────────────────────────────────────

// C ref: end.c:349 death_fixups[] — "some special cases for overriding
// while-helpless reason".
const death_fixups = [
    { why: STONING, unmulti: 1, exclude: 'getting stoned', include: null },
    { why: STARVING, unmulti: 0, exclude: 'fainted from lack of food',
      include: 'fainted' },
];

// C ref: end.c:366 fixup_death(how) — clear away while-helpless when the cause
// of death caused the helplessness ("petrified by <foo> while getting stoned").
export function fixup_death(how) {
    if (game.multi_reason) {
        for (let i = 0; i < death_fixups.length; ++i)
            if (death_fixups[i].why === how
                && death_fixups[i].exclude === game.multi_reason) {
                if (death_fixups[i].include) /* substitute alternate reason */
                    game.multi_reason = death_fixups[i].include;
                else /* remove the helplessness reason */
                    game.multi_reason = null;
                game.multireasonbuf = ''; /* dynamic buf stale either way */
                if (death_fixups[i].unmulti) /* possibly hide helplessness */
                    game.multi = 0;
                break;
            }
    }
}

// ── the dumplog pair (compiled out of the recorder build) ───────────────────

// C ref: windows.c:1366 dump_redirect(onoff) — swaps windowprocs for the
// dump_* set, but only when a dumplog file was opened; with none, in_dumplog
// is forced FALSE, which is what makes dump_everything()'s body unreachable
// here even if DUMPLOG were defined.
function dump_redirect(onoff_flag) {
    const iflags = game.iflags || (game.iflags = {});
    iflags.in_dumplog = game.dumplog_file ? onoff_flag : false;
}

// C ref: end.c:519 dump_plines() — the ^P message ring, oldest first, one space
// of indentation.  gs.saved_plines[] is a DUMPLOG_MSG_COUNT-entry circular
// buffer that this port does not keep (no saved_pline_index either), so the
// loop reads whatever ring the wiring pass installs.
export function dump_plines() {
    let buf = ' '; /* one space for indentation */
    putstr(0, 0, 'Latest messages:');
    const saved_plines = game.saved_plines || [];
    for (let i = 0, j = (game.saved_pline_index | 0); i < DUMPLOG_MSG_COUNT;
         ++i, j = (j + 1) % DUMPLOG_MSG_COUNT) {
        const strp = saved_plines[j];
        if (strp) {
            // copynchars(&buf[1], *strp, BUFSZ - 1 - 1)
            buf = ' ' + String(strp).slice(0, 254);
            putstr(0, 0, buf);
        }
    }
}

// C ref: end.c:542 dump_everything(how, when) — the whole end-of-game dump.
// Guarded exactly as C is: without DUMPLOG the function is `nhUse(how);
// nhUse(when);`, and even with it, dump_redirect() leaves in_dumplog FALSE
// unless a dumplog file was opened.  Statement order preserved; the parts with
// no js/ counterpart are named in comments rather than silently dropped.
export async function dump_everything(how, when) {
    if (!DUMPLOG) return; // C: #else nhUse(how); nhUse(when);
    dump_redirect(true);
    if (!game.iflags?.in_dumplog)
        return;

    // unported: init_symbols() — revert to the default symbol set.

    // unported: putstr(0, 0, getversionstring(pbuf, sizeof pbuf)); one-line
    // version ID including build date+time.
    putstr(0, 0, '');

    // game start and end date+time to disambiguate version date+time.
    // unported: yyyymmddhhmmss(ubirthday) / yyyymmddhhmmss(when).
    putstr(0, 0, '');

    // character name and basic role info.
    const female = !!game.flags?.female;
    putstr(0, 0, `${game.plname || ''}, ${game.u?.ualign?.adj || ''}`
        + ` ${female ? 'female' : 'male'} ${game.urace?.adj || ''}`
        + ` ${(female && game.urole?.name?.f) ? game.urole.name.f
                                              : (game.urole?.name?.m || '')}`);
    putstr(0, 0, '');

    // info about current game state.
    // unported: dump_map(); do_statusline1(); do_statusline2().
    putstr(0, 0, '');

    dump_plines();
    putstr(0, 0, '');
    putstr(0, 0, 'Inventory:');
    const I = await import('./invent.js');
    I.display_inventory(null, true);
    const inv = Array.isArray(game.invent) ? game.invent : [];
    await container_contents(inv, true, true, false);
    // enlightenment(BASICENLIGHTENMENT | MAGICENLIGHTENMENT, final)
    const final = (how >= PANICKED) ? 1 : 2; // ENL_GAMEOVERALIVE : ENL_GAMEOVERDEAD
    const insight = await import('./insight.js');
    for (const ln of insight.enlightenment_lines(final)) putstr(0, 0, ln);
    putstr(0, 0, '');

    // overview of the game up to this point.
    // unported: show_gamelog(final) — js/insight.js:860 keeps it private.
    putstr(0, 0, '');
    // unported: show_spells() — ends with a blank line.
    const { show_skills } = await import('./weapon.js');
    await show_skills(); /* ends with a blank line */
    await insight.show_conduct_disclosure(final); // show_conduct(final)
    putstr(0, 0, '');
    const { show_overview_disclosure } = await import('./extcmd-handlers.js');
    await show_overview_disclosure(final, how); // show_overview(final, how)
    putstr(0, 0, '');
    await insight.list_vanquished_screen(); // list_vanquished('d', FALSE)
    putstr(0, 0, '');
    // unported: list_genocided('d', FALSE) — the "Genocided species:" window.
    putstr(0, 0, '');
    dump_redirect(false);
}

// ── the valuables machinery (really_done's ESCAPED/ASCENDED branch) ─────────

// C ref: decl.h:155 `struct valuable_data amulets[LAST_AMULET + 1 -
// FIRST_AMULET]` and decl.h:417 `gems[LAST_REAL_GEM + 1 - FIRST_REAL_GEM + 1]`
// (the extra slot collects every glass gem), wired up by decl.c:1132-1137 as
// gv.valuables = {gems, amulets, NULL} — GEMS FIRST, which is the order
// really_done() lists them in.
const N_AMULETS = LAST_AMULET + 1 - FIRST_AMULET;
const N_GEMS = LAST_REAL_GEM_ + 1 - FIRST_REAL_GEM_ + 1;
const ga = { amulets: Array.from({ length: N_AMULETS },
                                 () => ({ count: 0, typ: 0 })) };
const gg = { gems: Array.from({ length: N_GEMS },
                              () => ({ count: 0, typ: 0 })) };
export const gv = {
    valuables: [
        { list: gg.gems, size: N_GEMS },
        { list: ga.amulets, size: N_AMULETS },
        { list: null, size: 0 },
    ],
};

// C ref: end.c:763 get_valuables(list) — collect amulets and gems from an
// inventory or container list, ignoring all artifacts.  "The list always
// remains intact."  No RNG.
export function get_valuables(list) {
    let i;
    for (const obj of (list || [])) {
        if (Has_contents(obj)) {
            get_valuables(obj.cobj);
        } else if (obj.oartifact) {
            continue;
        } else if (obj.oclass === AMULET_CLASS_) {
            i = obj.otyp - FIRST_AMULET;
            if (!ga.amulets[i].count) {
                ga.amulets[i].count = obj.quan;
                ga.amulets[i].typ = obj.otyp;
            } else
                ga.amulets[i].count += obj.quan; /* always adds one */
        } else if (obj.oclass === GEM_CLASS_ && obj.otyp <= LAST_GLASS_GEM) {
            /* last+1: combine all glass gems into one slot */
            i = Math.min(obj.otyp, LAST_REAL_GEM_ + 1) - FIRST_REAL_GEM_;
            if (!gg.gems[i].count) {
                gg.gems[i].count = obj.quan;
                gg.gems[i].typ = obj.otyp;
            } else
                gg.gems[i].count += obj.quan;
        }
    }
}

// C ref: end.c:798 sort_valuables(list, size) — insertion sort, greatest count
// to the front; empty slots are left where they are.  No RNG.
export function sort_valuables(list, size) {
    let j;
    /* move greater quantities to the front of the list */
    for (let i = 1; i < size; i++) {
        if (list[i].count === 0)
            continue;              /* empty slot */
        const ltmp = { ...list[i] }; /* structure copy */
        for (j = i; j > 0; --j) {
            if (list[j - 1].count >= ltmp.count)
                break;
            list[j] = list[j - 1];
        }
        list[j] = ltmp;
    }
}

// C ref: end.c:825-846 — odds_and_ends() sits inside a `#if 0` block: it was
// used for 3.6.0/3.6.1 and Schroedinger's cat is handled in really_done() as of
// 3.6.2.  Translated for completeness; note the rn2(2) it draws, which is what
// moved into really_done()'s observe_quantum_cat() call.
const CAT_CHECK = 2;
export function odds_and_ends(list, what) {
    for (const otmp of (list || [])) {
        switch (what) {
        case CAT_CHECK: /* Schroedinger's Cat */
            /* Ascending is deterministic */
            if (SchroedingersBox(otmp))
                return !!rn2_(2);
            break;
        }
        if (Has_contents(otmp))
            return odds_and_ends(otmp.cobj, what);
    }
    return false;
}

// C ref: end.c:907 artifact_score(list, counting, endwin) — "called twice;
// first to calculate total, then to list relevant items".  No RNG.  C is void
// and synchronous; async here only because arti_cost/discover_object/currency
// live behind dynamic imports in this file.
export async function artifact_score(list, counting, endwin) {
    const { arti_cost, artiname } = await import('./artifact.js');
    const { discover_object } = await import('./o_init.js');
    const { currency } = await import('./invent.js');
    for (const otmp of (list || [])) {
        if (otmp.oartifact || otmp.otyp === BELL_OF_OPENING
            || otmp.otyp === SPE_BOOK_OF_THE_DEAD
            || otmp.otyp === CANDELABRUM_OF_INVOCATION) {
            const value = arti_cost(otmp);            /* zorkmid value */
            const points = Math.trunc(value * 5 / 2); /* score value */
            if (counting) {
                game.u.urexp = nowrap_add(game.u.urexp, points);
            } else {
                discover_object(otmp.otyp, true, true, false);
                /* not observe_object; dead characters don't observe */
                otmp.known = otmp.dknown = otmp.bknown = otmp.rknown = 1;
                /* assumes artifacts don't have quan > 1 */
                putstr(endwin, 0,
                    `${the_unique_obj(otmp) ? 'The ' : ''}`
                    + `${otmp.oartifact ? artiname(otmp.oartifact)
                                        : OBJ_NAME(objects_[otmp.otyp])}`
                    + ` (worth ${value} ${currency(value)}`
                    + ` and ${points} points)`);
            }
        }
        if (Has_contents(otmp))
            await artifact_score(otmp.cobj, counting, endwin);
    }
}

// ── fuzzer_savelife ─────────────────────────────────────────────────────────

// C ref: end.c:945 fuzzer_savelife(how) — "when dying while running the debug
// fuzzer, [almost] always keep going".  Reached only from done() when
// iflags.debug_fuzzer is set, which no recorded session does.
//
// DRAW ORDER (this is the part that matters when it gets wired):
//   rn2(done_seq > hero_seq + 2 ? 2 : 10)      gate
//   rn2(3)                                     ONLY if ismnum(u.ulycn)
//   [POT_WATER remedy: mksobj + peffects draws]
//   rn2(3)                                     ONLY if remedies != 0
//   [POT_RESTORE_ABILITY remedy: mksobj + peffects draws]
//   rn2(3 + 3 * remedies)
//   rn2(3) x8                                  per eligible property, in
//                                              prop.h index order 1..8
//   rn2(5 + 5 * remedies)                      drawn even though C's body is
//                                              empty ("might confer ...")
export async function fuzzer_savelife(how) {
    const ps = game.program_state || (game.program_state = {});
    /*
     * Some debugging code pulled out of done() to unclutter it.
     * 'done_seq' is maintained in done().
     */
    if (!ps.panicking && how !== PANICKED && how !== TRICKED) {
        savelife(how);

        /* periodically restore characteristics plus lost experience levels or
           cure lycanthropy or both */
        if (!rn2_(((game.done_seq | 0) > hero_seq() + 2) ? 2 : 10)) {
            const { mksobj, bless } = await import('./mkobj.js');
            const { obfree } = await import('./invent.js');
            const { peffects } = await import('./potion.js');
            const u = game.u;
            let potion, proptim, remedies = 0;

            /* get rid of temporary potion with obfree() rather than useup()
               because it doesn't get entered into inventory */
            if (ismnum_(u.ulycn ?? -1) && !rn2_(3)) {
                potion = mksobj(POT_WATER_, true, false);
                bless(potion);
                await peffects(potion);
                obfree(potion, null);
                ++remedies;
            }
            if (!remedies || rn2_(3)) {
                potion = mksobj(POT_RESTORE_ABILITY, true, false);
                bless(potion);
                await peffects(potion);
                obfree(potion, null);
                ++remedies;
            }
            if (!rn2_(3 + 3 * remedies)) {
                /* confer temporary resistances for first 8 properties:
                   fire, cold, sleep, disint, shock, poison, acid, stone.
                   C indexes u.uprops[propidx].intrinsic/.extrinsic; this port
                   splits those into u.H<name> / u.E<name> (js/attrib.js:247),
                   so index -> name via prop.h's enum order. */
                for (let propidx = 1; propidx <= 8; ++propidx) {
                    const nm = PROP_NAMES_1_8[propidx];
                    if (!u[`H${nm}`] && !u[`E${nm}`]
                        && (proptim = rn2_(3)) > 0) /* 0..2 */
                        u[`H${nm}`] = set_itimeout_(u[`H${nm}`],
                                                    2 * proptim + 1); /* 3 or 5 */
                }
                ++remedies;
            }
            if (!rn2_(5 + 5 * remedies)) {
                /* might confer temporary Antimagic (magic resistance)
                 * or even Invulnerable */
            }
        }
        /* clear stale cause of death info after life-saving */
        const killer = svk_killer();
        killer.name = '';
        killer.format = 0;
        game._killer_name = ''; /* this port's parallel killer string */

        /*
         * Guard against getting stuck in a loop if we die in one of the few
         * ways where life-saving isn't effective.
         */
        const seq = game.done_seq | 0; /* C: gd.done_seq++ > ... (post-incr) */
        game.done_seq = seq + 1;
        if (seq > hero_seq() + 100) {
            if (!is_wizard())
                return false; /* can't deal with it */
            // unported: cmdq_add_ec(CQ_CANNED, wiz_makemap) — js/ has no cmdq.
        }

        return true;
    }
    return false; /* panic or too many consecutive deaths */
}

// C ref: prop.h:1-8 FIRE_RES..STONE_RES, as the H*/E* field names this port
// uses for intrinsic/extrinsic (js/artifact.js:546-551).
const PROP_NAMES_1_8 = [
    null, 'Fire_resistance', 'Cold_resistance', 'Sleep_resistance',
    'Disint_resistance', 'Shock_resistance', 'Poison_resistance',
    'Acid_resistance', 'Stone_resistance',
];

// ── container_contents ──────────────────────────────────────────────────────

// C ref: end.c:1594 container_contents(list, identified, all_containers,
// reportempty) — "used for disclosure and for the ':' choice when looting a
// container".  No RNG.
//
// The (box, FALSE, FALSE, TRUE) flavour is ALREADY LIVE, folded into
// js/extcmd-handlers.js render_container_contents() with the tty corner-window
// renderer inlined.  Do not wire this over that call site without replacing it
// — two copies of the same window is the duplicate-reimplementation trap.  The
// missing flavour is disclose()'s (gi.invent, TRUE, TRUE, FALSE) recursion
// (end.c:641), which end.js's disclose() currently notes as unported.
export async function container_contents(list, identified, all_containers,
                                         reportempty) {
    const dumping = !!game.iflags?.in_dumplog;
    const I = await import('./invent.js');
    const { discover_object } = await import('./o_init.js');
    const d = await deps();

    for (const box of (list || [])) {
        if (Is_container(box) || box.otyp === STATUE_) {
            if (!box.cknown || (identified && !box.lknown)) {
                box.cknown = 1; /* we're looking at the contents now */
                if (identified)
                    box.lknown = 1;
                I.update_inventory();
            }
            if (box.otyp === BAG_OF_TRICKS_) {
                continue; /* wrong type of container */
            } else if (box.cobj && box.cobj.length) {
                const tmpwin = create_nhwindow(4 /* NHW_MENU */);

                /* at this stage, the SchroedingerBox() flag is only set if the
                   cat inside the box is alive */
                const cat = SchroedingersBox(box);

                putstr(tmpwin, 0, `Contents of ${the_(I.xname(box))}:`);
                if (!dumping)
                    putstr(tmpwin, 0, '');
                /* C: buf[0] = buf[1] = ' ' — two leading spaces per item */
                if (box.cobj.length && !cat) {
                    const sortloot_opt = game.flags?.sortloot;
                    const sortflags =
                        ((sortloot_opt === 'l' || sortloot_opt === 'f')
                             ? I.SORTLOOT_LOOT : 0)
                        | (game.flags?.sortpack ? I.SORTLOOT_PACK : 0);
                    const sortedcobj = I.sortloot(box.cobj, sortflags, false,
                                                  null);
                    for (const srtc of sortedcobj) {
                        const obj = srtc.obj;
                        if (!obj) break;
                        if (identified) {
                            discover_object(obj.otyp, true, true, false);
                            obj.dknown = 1; /* observe_object unnecessary */
                            obj.known = obj.bknown = obj.rknown = 1;
                            if (Is_container(obj) || obj.otyp === STATUE_)
                                obj.cknown = obj.lknown = 1;
                        }
                        // doname_with_price() is private to js/invent.js;
                        // floor_object_name() is its exported wrapper (:545).
                        putstr(tmpwin, 0, '  ' + I.floor_object_name(obj));
                    }
                    I.unsortloot(sortedcobj);
                } else if (cat) {
                    putstr(tmpwin, 0, "  Schroedinger's cat!");
                }
                if (dumping)
                    putstr(0, 0, '');
                display_nhwindow(tmpwin, true);
                destroy_nhwindow(tmpwin);
                if (all_containers)
                    await container_contents(box.cobj, identified, true,
                                             reportempty);
            } else if (reportempty) {
                // thesimpleoname(box) == the(xname(box)) (js/pickup.js:202)
                await d.pline(`${upstart(the_(I.xname(box)))} is empty.`);
                // display_nhwindow(WIN_MESSAGE, FALSE)
            }
        }
        if (!all_containers)
            break;
    }
}

// ── the delayed-killer list ─────────────────────────────────────────────────

// C ref: decl.h svk.killer is `struct kinfo { name[]; format; id; next }` and
// the delayed killers hang off its .next chain.  This port keeps game.killer =
// {name, format} (js/explode.js:456, js/pickup.js:518); give it the id/next
// fields C's list walk needs.
//
// NOTE js/eat.js:1316 and js/monmove.js:7378 use a separate
// game._delayed_killer STRING for the two delayed killers they need.  A wiring
// pass must REPLACE those, not shadow them.
function svk_killer() {
    if (!game.killer)
        game.killer = { name: '', format: KILLED_BY_AN, id: 0, next: null };
    if (game.killer.next === undefined)
        game.killer.next = null;
    return game.killer;
}

// C ref: end.c:1707 delayed_killer(id, format, killername) — "set a delayed
// killer, ensure non-delayed killer is cleared out".
export function delayed_killer(id, format, killername) {
    const killer = svk_killer();
    let k = find_delayed_killer(id);

    if (!k) {
        /* no match, add a new delayed killer to the list */
        k = { id, format: 0, name: '', next: killer.next };
        killer.next = k;
    }

    k.format = format;
    k.name = killername ? killername : '';
    killer.name = '';
}

// C ref: end.c:1726 find_delayed_killer(id).
export function find_delayed_killer(id) {
    let k;
    for (k = svk_killer().next; k !== null && k !== undefined; k = k.next) {
        if (k.id === id)
            break;
    }
    return k || null;
}

// C ref: end.c:1738 dealloc_killer(kptr) — unlink and free one delayed killer.
export function dealloc_killer(kptr) {
    const killer = svk_killer();
    let prev = killer, k;

    if (!kptr)
        return;
    for (k = killer.next; k !== null && k !== undefined; k = k.next) {
        if (k === kptr)
            break;
        prev = k;
    }

    if (!k) {
        // impossible("dealloc_killer (#%d) not on list", kptr->id)
        const { impossible } = _display || {};
        if (impossible) impossible(`dealloc_killer (#${kptr.id}) not on list`);
    } else {
        prev.next = k.next;
        /* free(k); debugpline1("freed delayed killer #%d", kptr->id); */
    }
}

// C ref: end.c:1760 save_killers(nhfp) — write svk.killer plus every delayed
// killer, then (when freeing) drop the chain.  hack.h:971-972:
// update_file(nhfp) == mode & (COUNTING | WRITING), release_data == mode &
// FREEING.  js/storage.js is frozen and owns its own format, so Sfo_kinfo()
// here just appends the record to whatever sink nhfp carries.
export function save_killers(nhfp) {
    if (update_file(nhfp)) {
        for (let kptr = svk_killer(); kptr; kptr = kptr.next)
            Sfo_kinfo(nhfp, kptr, 'kinfo');
    }
    if (release_data(nhfp)) {
        const killer = svk_killer();
        while (killer.next) {
            const kptr = killer.next.next;
            /* free(svk.killer.next) */
            killer.next = kptr;
        }
    }
}

// C ref: end.c:1780 restore_killers(nhfp) — read svk.killer and re-allocate
// one successor per non-null .next as it comes back off the file.
export function restore_killers(nhfp) {
    for (let kptr = svk_killer(); kptr !== null && kptr !== undefined;
         kptr = kptr.next) {
        Sfi_kinfo(nhfp, kptr, 'kinfo');
        if (kptr.next) {
            kptr.next = { name: '', format: 0, id: 0, next: null };
        }
    }
}

// hack.h:964-972 mode bits; sfbase.c Sfo_/Sfi_ marshalling (coverage N/A).
const COUNTING = 1, WRITING = 2, FREEING = 8;
function update_file(nhfp) { return ((nhfp?.mode | 0) & (COUNTING | WRITING)); }
function release_data(nhfp) { return ((nhfp?.mode | 0) & FREEING); }
function Sfo_kinfo(nhfp, kptr, _tag) {
    if (nhfp && Array.isArray(nhfp.records))
        nhfp.records.push({ name: kptr.name, format: kptr.format, id: kptr.id,
                            next: !!kptr.next });
}
function Sfi_kinfo(nhfp, kptr, _tag) {
    if (!nhfp || !Array.isArray(nhfp.records)) return;
    const rec = nhfp.records.shift();
    if (!rec) return;
    kptr.name = rec.name;
    kptr.format = rec.format;
    kptr.id = rec.id;
    kptr.next = rec.next ? kptr.next || {} : null;
}

// ── wordcount / bel_copy1 / build_english_list ──────────────────────────────

// C ref: end.c:1793 wordcount(p) — number of whitespace-separated words.
export function wordcount(p) {
    const s = String(p ?? '');
    let words = 0, i = 0;

    while (i < s.length) {
        while (i < s.length && isspace_(s[i]))
            i++;
        if (i < s.length)
            words++;
        while (i < s.length && !isspace_(s[i]))
            i++;
    }
    return words;
}

// C ref: end.c:1809 bel_copy1(inp, out) — copy ONE word from *inp, APPENDING at
// eos(out), and advance *inp past it.  C's char** / char* become a cursor
// object { s, i } and a buffer object { s }: `out += strlen(out)` is why out
// must be a mutable holder rather than a returned string.
export function bel_copy1(inp, out) {
    const s = String(inp.s ?? '');
    let i = inp.i | 0;
    /* out += strlen(out); -- eos() */
    while (i < s.length && isspace_(s[i]))
        i++;
    let word = '';
    while (i < s.length && !isspace_(s[i]))
        word += s[i++];
    out.s = (out.s || '') + word; /* *out++ = *in++; *out = '\0' */
    inp.i = i;
}

// C ref: end.c:1823 build_english_list(in) — "a b c" -> "a, b, or c".  Called
// from options.c for the autounlock/paranoid_confirmation value lists
// (js/cfgfiles.js:414 records it as not ported).
export function build_english_list(inp) {
    const p = { s: String(inp ?? ''), i: 0 };
    let words = wordcount(p.s);
    /* C allocs len + (words > 1 ? 3 + (words - 1) : 0) + 1 and starts the
       buffer empty because bel_copy1() appends. */
    const out = { s: '' };

    switch (words) {
    case 0:
        // impossible("no words in list")
        break;
    case 1:
        /* "single" */
        bel_copy1(p, out);
        break;
    default:
        if (words === 2) {
            /* "first or second" */
            bel_copy1(p, out);
            out.s += ' ';
        } else {
            /* "first, second, or third" */
            do {
                bel_copy1(p, out);
                out.s += ', ';
            } while (--words > 1);
        }
        out.s += 'or ';
        bel_copy1(p, out);
        break;
    }
    return out.s;
}
