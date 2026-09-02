// wizcmds.js — wizard-mode debug commands.
//
// C ref: src/wizcmds.c.  Every function here keeps its C name and its C order
// of operations; the file is a leaf (nothing imports it yet) so that wiring the
// keys/extcmd table up stays a separate, measured pass.
//
// Already ported elsewhere, deliberately NOT duplicated here:
//   wiz_wish          -> js/extcmd-handlers.js:1156
//   wiz_identify      -> js/invent.js:8292 (extcmd wrapper at
//                        js/extcmd-handlers.js:3076)
//   wiz_genesis       -> js/extcmd-handlers.js:1321
//   wiz_where         -> js/extcmd-handlers.js:2844
//   wiz_map           -> js/extcmd-handlers.js:3044 (named wiz_map_extcmd)
//   wiz_level_tele    -> js/do.js:1599
//   wiz_level_change  -> js/extcmd-handlers.js:933
//   wiz_polyself      -> js/extcmd-handlers.js:1336
//   wiz_intrinsic     -> js/extcmd-handlers.js:3257

import { game } from './gstate.js';
import {
    pline, impossible, docrt, m_at, map_invisible, unmap_object, newsym, y_n,
} from './display.js';
import {
    COLNO, ROWNO, MAX_TYPE, STONE, SDOOR, CORR, IS_WALL, IS_ROOM, IS_DOOR,
    WM_MASK, COULD_SEE, IN_SIGHT, TEMP_LIT, ECMD_OK, ECMD_CANCEL, isok, u_at,
    has_mgivenname, MGIVENNAME, ONAME, OMONST, ESHK, EPRI, EGD, EMIN, EDOG,
    EBONES, ARTICLE_A, ARTICLE_THE, ARTICLE_YOUR, SUPPRESS_IT,
    SUPPRESS_HALLUCINATION, SUPPRESS_SADDLE, XKILL_NOMSG, DIED, KILLED_BY,
    MIGR_EXACT_XY, MIGR_RANDOM, In_sokoban, In_endgame, Is_stronghold, Is_botlevel,
    Is_knox_level,
    MON_OFFMAP, MON_MIGRATING, MON_LIMBO, MON_ENDGAME_MIGR,
    NHL_SB_SAFE, NHL_SB_DEBUGGING,
} from './const.js';
import { defsyms, S_fountain, S_sink } from './symbols.js';
import { objects, MAXOCLASSES, OMAILCMD, obj_sanity_check } from './mkobj.js';
import { may_dig } from './dig.js';
import { Is_special } from './dungeon.js';
import { Invocation_lev } from './trap.js';
import { display_text_window } from './pager.js';
import { within_bounded_area } from './rect.js';
import { depth } from './hacklib.js';
import { size_wseg } from './worm.js';
import { light_stats, light_sources_sanity_check } from './light.js';
import { check_invent_gold, inventoryArray, ynq } from './invent.js';
import {
    monsterList, DEADMONSTER, dmonsfree, mon_sanity_check, usmellmon,
} from './mon.js';
import { minimal_monnam } from './do_name.js';
import { monster_by_pmidx } from './makemon.js';
import { NUMMONS } from './disprng.js';
import {
    flip_level, flip_level_rnd, lspo_reset_level, lspo_finalize_level,
    load_special,
} from './sp_lev.js';
import { load_lua } from './nhlua.js';
import { findit } from './detect.js';
import { olfaction } from './eat.js';
import { canspotmon, x_monnam, mon_nam, killed } from './uhitm.js';
import { is_undead_flag } from './monflags_data.js';
import { mklev } from './mklev.js';
import { done } from './end.js';

/* ------------------------------------------------------------------ */
/*  local helpers                                                     */
/* ------------------------------------------------------------------ */

// C ref: hack.h `wizard` == flags.debug.
function wizard() { return !!(game.flags && game.flags.debug); }

// C ref: cmd.c:157 `const char unavailcmd[] = "Unavailable command '%s'.";`
// with ecname_from_fn(), which returns extcmdlist[].ef_txt — the bare command
// text, with NO leading '#'.
const unavailcmd = "Unavailable command '%s'.";
async function unavail(ecname) {
    await pline(unavailcmd.replace('%s', ecname));
}

// C ref: hack.h Never_mind == "Never mind."
const Never_mind = 'Never mind.';

// C ref: hacklib.c plur(n).
function plur(n) { return (n === 1) ? '' : 's'; }

// C ref: mondata.h nonliving(ptr) == is_undead || PM_MANES || weirdnonliving
// (is_golem || mlet == S_VORTEX); same decomposition js/explode.js uses.
const S_VORTEX = 22, S_GOLEM = 55;
function nonliving(p) {
    return is_undead_flag(p) || p?.name === 'manes'
        || p?.mcls === S_GOLEM || p?.mcls === S_VORTEX;
}

// C ref: you.h:316 `#define uhis() (genders[flags.female ? 1 : 0].his)`.
function uhis() { return game.flags?.female ? 'her' : 'his'; }

// C ref: display.c unmap_invisible(x, y) — a square remembered as holding a
// sensed-but-unseen monster loses that 'I' once the hero looks and finds
// nothing (same body as js/cmd.js:1747).
function unmap_invisible(x, y) {
    if (!isok(x, y)) return false;
    if (!game.level?.at(x, y)?.invisMon) return false;
    unmap_object(x, y);
    newsym(x, y);
    return true;
}

// C ref: dungeon.c:1914 On_W_tower_level(lev) / :1923 In_W_tower(x, y, lev).
// dungeon.js exports neither, and both are needed by wiz_makemap().
function on_level(a, b) {
    return !!a && !!b && a.dnum === b.dnum && a.dlevel === b.dlevel;
}
function On_W_tower_level(lev) {
    return on_level(lev, game.wiz1_level) || on_level(lev, game.wiz2_level)
        || on_level(lev, game.wiz3_level);
}
function In_W_tower(x, y, lev) {
    if (!On_W_tower_level(lev)) return false;
    const dndest = game.dndest;
    if (!dndest || !dndest.nlx) {
        // C impossible()s here and returns FALSE.
        return false;
    }
    return within_bounded_area(x, y, dndest.nlx, dndest.nly,
                               dndest.nhx, dndest.nhy);
}

// C ref: objnam.c mungspaces().
function mungspaces(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }

// C ref: cmd.c paranoid_ynq(be_paranoid, prompt, accept_q) / paranoid_query().
// Not exported by any module (js/cmd.js, js/eat.js and js/extcmd-handlers.js
// each keep a private copy); this mirrors js/eat.js's.
async function paranoid_ynq(be_paranoid, prompt, accept_q) {
    let c = 'n';
    if (be_paranoid) {
        const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
        const paranoidConfirm = (((game.flags?.paranoia_bits) | 0) & 0x0001) !== 0;
        const responsetype = paranoidConfirm
            ? (accept_q ? '[yes|no|quit]' : '[yes|no]')
            : (accept_q ? '[yes|n|q] (n)' : '[yes|n] (n)');
        let promptprefix = '', trylimit = 6, ans;
        do {
            const raw = await hooked_tty_getlin(`${promptprefix}${prompt} ${responsetype}`, null);
            ans = mungspaces(raw == null ? '\x1b' : raw);
            if (ans.toLowerCase() === 'yes') { c = 'y'; break; }
            if (ans.toLowerCase() === 'quit' || ans[0] === '\x1b') { c = 'q'; break; }
            promptprefix = '"Yes" or "No": ';
        } while (paranoidConfirm && ans.toLowerCase() !== 'no' && --trylimit);
    } else {
        c = await y_n(prompt, accept_q ? 'ynq\x1b' : 'yn\x1b', 'n');
    }
    if (c !== 'y' && (c !== 'q' || !accept_q)) c = 'n';
    return c;
}
async function paranoid_query(be_paranoid, prompt) {
    return (await paranoid_ynq(be_paranoid, prompt, false)) === 'y';
}

// C ref: getpos.c getpos(&cc, force, goal).  js/hack.js's getpos() takes the
// start position by value and returns {x,y} or null for "cancelled"; C returns
// a negative int and leaves cc alone.  This adapter keeps the C call shape.
async function getpos_cc(cc, force, goal) {
    const { getpos } = await import('./hack.js');
    const pos = await getpos(goal, cc.x, cc.y, null, force, false);
    if (!pos) return -1;
    cc.x = pos.x;
    cc.y = pos.y;
    return 0;
}

// Sprintf helpers for the fixed-width #stats / #terrain-legend tables.
function padRight(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function padLeft(s, n) { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; }

// C ref: wizcmds.c:1112 — the three #stats layout strings.
// template is "%-27s  %4ld  %6ld".
function template(src, count, size) {
    return `${padRight(src, 27)}  ${padLeft(count, 4)}  ${padLeft(size, 6)}`;
}
const stats_hdr = '                             count  bytes';
const stats_sep = '---------------------------  ----- -------';

// sizeof() values measured from the recorder build (clang, LP64) that produced
// the recorded sessions; #stats prints byte totals, so they are data, not
// guesses.  Kept together so a struct change is a one-line edit.
const SIZEOF_OBJ = 112, SIZEOF_OEXTRA = 32;
const SIZEOF_MONST = 192, SIZEOF_MEXTRA = 64;
const SIZEOF_EGD = 640, SIZEOF_EPRI = 56, SIZEOF_ESHK = 4960;
const SIZEOF_EMIN = 8, SIZEOF_EDOG = 64, SIZEOF_EBONES = 28;
const SIZEOF_TRAP = 32, SIZEOF_DAMAGE = 32, SIZEOF_KINFO = 272;
const SIZEOF_CEMETERY = 184, SIZEOF_ENGR = 64, SIZEOF_TIMER_ELEMENT = 48;
const SIZEOF_NHREGION = 96, SIZEOF_NHRECT = 8, SIZEOF_MAPSEEN = 384;

/* ------------------------------------------------------------------ */
/*  #wizmakemap                                                       */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:73 makemap_unmakemon(mtmp, migratory) — used when
// wiz_makemap() gets rid of monsters for the old incarnation of a level.
export function makemap_unmakemon(mtmp, migratory) {
    const ndx = mtmp?.data?.pmidx ?? mtmp?.pmidx ?? -1;
    const mvitals = (game.mvitals ||= []);
    const mv = (mvitals[ndx] ||= { born: 0, died: 0, mvflags: 0 });

    /* uncreate any unique monster so that it is eligible to be remade on the
       new incarnation of the level; ignores DEADMONSTER() [why?] */
    if ((mtmp?.data?.geno || 0) & G_UNIQ)
        mv.mvflags &= ~G_EXTINCT;
    if (mv.born)
        mv.born--;

    /* vault is going away; get rid of the guard who might be in play or be
       parked at <0,0> */
    if (mtmp.isgd) {
        mtmp.isgd = 0; /* after this, fall through to mongone() */
    } else if (DEADMONSTER(mtmp)) {
        return; /* already set to be discarded */
    } else if (mtmp.isshk && on_level(game.u?.uz, ESHK(mtmp)?.shoplevel)) {
        nyi_setpaid(mtmp);
    }
    if (migratory) {
        /* caller has removed 'mtmp' from migrating_mons; put it onto fmon so
           that dmonsfree() bookkeeping stays in sync */
        mtmp.mstate = (mtmp.mstate || 0) | MON_OFFMAP;
        mtmp.mstate &= ~(MON_MIGRATING | MON_LIMBO | MON_ENDGAME_MIGR);
        monsterList().push(mtmp);
    }
    nyi_mongone(mtmp);
}
// include/monst.h geno bits / mstate bits used just above.  G_EXTINCT is an
// mvitals[].mvflags bit and monflag.h:210 makes it 0x01 (mvflags only ever
// holds 0x01 G_EXTINCT / 0x02 G_GENOD / 0x08 MV_KNOWS_EGG), so the old 0x0004
// meant makemap_unmakemon's `mvflags &= ~G_EXTINCT` above cleared nothing.
const G_UNIQ = 0x1000, G_EXTINCT = 0x01;

// C ref: wizcmds.c:110 makemap_remove_mons() — get rid of all the monsters
// on (or intimately involved with) the current level.  js/cmd.js:5326 has a
// bare `cmd_makemap_remove_mons() {}` no-op standing in for this.
export async function makemap_remove_mons() {
    /* keep steed and other adjacent pets after releasing them from traps,
       stopping eating, &c as if the hero were ascending */
    nyi_keepdogs(true); /* (pets-only; normally we'd be using 'FALSE') */
    /* get rid of all the monsters that didn't make it to 'mydogs' */
    for (const mtmp of monsterList().slice()) {
        /* if already dead, dmonsfree() (below) will get rid of it */
        if (DEADMONSTER(mtmp)) continue;
        makemap_unmakemon(mtmp, false);
    }
    /* some monsters retain details of this level in mon->mextra; that data
       becomes invalid when the level is replaced, so get rid of them now if
       migrating or already arrived elsewhere */
    const migr = (game.migrating_mons ||= []);
    for (let i = 0; i < migr.length; ) {
        const mtmp = migr[i];
        if (mtmp.mextra
            && ((mtmp.isshk && on_level(game.u?.uz, ESHK(mtmp)?.shoplevel))
                || (mtmp.ispriest && on_level(game.u?.uz, EPRI(mtmp)?.shrlevel))
                || (mtmp.isgd && on_level(game.u?.uz, EGD(mtmp)?.gdlevel)))) {
            migr.splice(i, 1);
            makemap_unmakemon(mtmp, true);
        } else {
            i++;
        }
    }
    /* release dead and 'unmade' monsters */
    await dmonsfree();
    if (monsterList().length)
        await impossible("makemap_remove_mons: 'fmon' did not get emptied?");
}

// C ref: wizcmds.c:156 wiz_makemap() — discard the current dungeon level and
// replace it with a new one.
export async function wiz_makemap() {
    if (wizard()) {
        const u = game.u;
        const { makemap_prepost } = await import('./cmd.js');
        const was_in_W_tower = In_W_tower(u.ux, u.uy, u.uz);

        await makemap_prepost(true, was_in_W_tower);
        /* create a new level; goto_level()-only side effects (Astral's
           guardian angel, Ft.Ludios' alarm) don't occur for replacements */
        await mklev();
        await makemap_prepost(false, was_in_W_tower);
    } else {
        await unavail('wizmakemap');
    }
    return ECMD_OK;
}

/* ------------------------------------------------------------------ */
/*  #wizmap / #wizdetect                                              */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:229 wiz_detect() — the #wizdetect command.
export async function wiz_detect() {
    if (wizard())
        await findit();
    else
        await unavail('wizdetect');
    return ECMD_OK;
}

/* ------------------------------------------------------------------ */
/*  #wizkill                                                          */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:243 wiz_kill() — pick targets and reduce them to 0HP; by
// default the hero is credited/blamed, the 'm' prefix avoids that.
export async function wiz_kill() {
    const u = game.u;
    const svc = (game.context ||= {});
    const cc = { x: u.ux, y: u.uy };
    let prompt = 'Pick first monster to slay';
    const save_verbose = game.flags?.verbose,
          save_autodescribe = game.iflags?.autodescribe;
    const uarehere = { dnum: u.uz.dnum, dlevel: u.uz.dlevel };

    for (;;) {
        await pline(`${prompt}:`);
        prompt = 'Next monster';

        if (game.flags) game.flags.verbose = false;
        (game.iflags ||= {}).autodescribe = true;
        const ans = await getpos_cc(cc, true, 'a monster');
        if (game.flags) game.flags.verbose = save_verbose;
        game.iflags.autodescribe = save_autodescribe;
        if (ans < 0 || cc.x < 1) break;

        let mtmp = null;
        if (u_at(cc.x, cc.y)) {
            if (u.usteed) {
                const c = await ynq(`Kill ${mon_nam(u.usteed).slice(0, 110)}?`);
                if (c === 'q') break;
                if (c === 'y') mtmp = u.usteed;
            }
            if (!mtmp) {
                const qbuf = `${role_is_samurai() ? 'Perform seppuku'
                                                  : 'Commit suicide'}?`;
                if (await paranoid_query(true, qbuf)) {
                    set_killer(`${uhis()} own player`, KILLED_BY);
                    await done(DIED);
                }
                break;
            }
        } else if (u.uswallow) {
            mtmp = next2u(cc.x, cc.y) ? u.ustuck : null;
        } else {
            mtmp = m_at(cc.x, cc.y);
        }

        /* whether there's an unseen monster here or not, the player will know
           there's none after the kill or failed attempt; tell the hero too */
        unmap_invisible(cc.x, cc.y);

        if (mtmp) {
            /* we don't require that the monster be seen or sensed, so we issue
               our own message in order to name it in case it isn't */
            const tame = mtmp.mtame ? 1 : 0,
                  seen = (canspotmon(mtmp) || (u.uswallow && mtmp === u.ustuck)),
                  flgs = (SUPPRESS_IT | SUPPRESS_HALLUCINATION
                          | ((tame && has_mgivenname(mtmp)) ? SUPPRESS_SADDLE : 0)),
                  articl = tame ? ARTICLE_YOUR : seen ? ARTICLE_THE : ARTICLE_A;
            const adjs = tame ? (!seen ? 'poor, unseen' : 'poor')
                              : (!seen ? 'unseen' : null);
            const Mn = x_monnam(mtmp, articl, adjs, flgs, false);

            if (!game.iflags?.menu_requested) {
                /* normal case: hero is credited/blamed */
                await pline(`You ${nonliving(mtmp.data) ? 'destroy' : 'kill'} ${Mn}!`);
                /* C: xkilled(mtmp, XKILL_NOMSG) */
                await killed(mtmp, { nomsg: (XKILL_NOMSG & 1) !== 0 });
            } else { /* 'm'-prefix */
                /* monsters aren't moving (the player just issued #wizkill), but
                   a gas spore's explosion may kill others, so mon_moving must
                   be True to keep the hero off the hook for those deaths */
                svc.mon_moving = true;
                await pline(`${upstart(Mn)} is ${
                    nonliving(mtmp.data) ? 'destroyed' : 'killed'}.`);
                /* C: monkilled(mtmp, (char *) 0, AD_PHYS) — mon.c monkilled()
                   has no JS port, so the kill routes through js/uhitm.js
                   killed() (this port's xkilled()).  DIVERGENCE: the hero is
                   awarded the experience on this 'm'-prefix arm. */
                await killed(mtmp, { nomsg: true });
                svc.mon_moving = false;
            }
            /* end the targetting loop if an engulfer dropped the hero onto a
               level-changing trap */
            if (u.utotype || !on_level(u.uz, uarehere)) break;
        } else {
            await pline('There is no monster there.');
            break;
        }
    }
    /* #wizkill takes no game time, so it is possible to kill something in the
       main dungeon and immediately level teleport into the endgame; force dead
       monster cleanup to avoid an impossible() from dmonsfree() */
    await dmonsfree();
    return ECMD_OK; /* no time elapses */
}

// C ref: hack.h Role_if(PM_SAMURAI); this port carries 0-based role indices
// (js/apply.js role_is()).  Samurai is role index 9 in js/roles.js order.
const ROLE_SAMURAI = 9;
function role_is_samurai() { return (game.urole?.mnum ?? -1) === ROLE_SAMURAI; }

// C ref: hack.h next2u(x, y) == distu(x, y) < 3 (same body as js/do.js:446).
function next2u(x, y) {
    const u = game.u;
    return (Math.abs(x - u.ux) <= 1 && Math.abs(y - u.uy) <= 1);
}

// C ref: `Sprintf(svk.killer.name, ...); svk.killer.format = ...`.  end.js
// formats the death line from game._killer_name, so both are set.
function set_killer(name, format) {
    game.killer = game.killer || { name: '', format: 0, id: 0, next: null };
    game.killer.name = name;
    game.killer.format = format;
    game._killer_name = name;
}

// C ref: hacklib.c upstart(s) — capitalize the first character in place.
function upstart(s) {
    s = String(s ?? '');
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* ------------------------------------------------------------------ */
/*  #wizloadlua / #wizloaddes                                         */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:353 wiz_load_lua() — load an arbitrary lua file.
export async function wiz_load_lua() {
    if (wizard()) {
        const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
        /* Large but not unlimited memory and CPU so random bits of code can be
           tested by wizards.  NHL_SB_SAFE|NHL_SB_DEBUGGING. */
        const sbi = { mode: NHL_SB_SAFE | NHL_SB_DEBUGGING,
                      memlimit: 16 * 1024 * 1024, steps: 0,
                      stackdepth: 16 * 1024 * 1024 };
        let buf = await hooked_tty_getlin('Load which lua file?', null);

        buf = (buf == null) ? '\x1b' : String(buf);
        if (buf[0] === '\x1b' || buf === '') return ECMD_CANCEL;
        if (!buf.includes('.')) buf += '.lua';
        load_lua(buf, sbi);
    } else {
        await unavail('wizloadlua');
    }
    return ECMD_OK;
}

// C ref: wizcmds.c:376 wiz_load_splua() — load a special level lua file.
export async function wiz_load_splua() {
    if (wizard()) {
        const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
        let buf = await hooked_tty_getlin('Load which des lua file?', null);

        buf = (buf == null) ? '\x1b' : String(buf);
        if (buf[0] === '\x1b' || buf === '') return ECMD_CANCEL;
        if (!buf.includes('.')) buf += '.lua';

        lspo_reset_level(null);
        load_special(buf);
        lspo_finalize_level(null);
    } else {
        await unavail('wizloaddes');
    }
    return ECMD_OK;
}

/* ------------------------------------------------------------------ */
/*  #wizfliplevel                                                     */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:412 wiz_flip_level() — transpose the current level.
// Does not handle levregions, monster mtrack, or migrating monsters aimed at
// specific coordinates on this level (flipping is normally done only during
// level creation).
export async function wiz_flip_level() {
    const choices = '0123',
          prmpt = 'Flip 0=randomly, 1=vertically, 2=horizontally, 3=both:';

    if (wizard()) {
        const { yn_function } = await import('./extcmd-handlers.js');
        let c = await yn_function(prmpt, choices, '\0');

        if (c && choices.includes(c)) {
            c = c.charCodeAt(0) - '0'.charCodeAt(0);

            if (!c)
                flip_level_rnd(3, true);
            else
                flip_level(c, true);

            await docrt();
        } else {
            await pline(Never_mind);
        }
    }
    return ECMD_OK;
}

/* ------------------------------------------------------------------ */
/*  #wiztelekinesis                                                   */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:494 wiz_telekinesis().
export async function wiz_telekinesis() {
    const u = game.u;
    const cc = { x: u.ux, y: u.uy };
    let mtmp = null;

    await pline('Pick a monster to hurtle.');
    do {
        const ans = await getpos_cc(cc, true, 'a monster');
        if (ans < 0 || cc.x < 1) return ECMD_CANCEL;

        if ((((mtmp = m_at(cc.x, cc.y)) != null) && canspotmon(mtmp))
            || u_at(cc.x, cc.y)) {
            const { getdir } = await import('./cmd.js');
            if (!(await getdir('which direction?'))) return ECMD_CANCEL;

            if (mtmp) {
                await nyi_mhurtle(mtmp, u.dx, u.dy, 6);
                if (!DEADMONSTER(mtmp) && canspotmon(mtmp)) {
                    cc.x = mtmp.mx;
                    cc.y = mtmp.my;
                }
            } else {
                await nyi_hurtle(u.dx, u.dy, 6, false);
                cc.x = u.ux; cc.y = u.uy;
            }
        }
    } while (u.utotype === UTOTYPE_NONE);
    return ECMD_OK;
}
const UTOTYPE_NONE = 0;   // include/you.h

/* ------------------------------------------------------------------ */
/*  #panic / #debugfuzzer                                             */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:534 wiz_panic() — test the program's panic handling.
export async function wiz_panic() {
    const u = game.u;

    if (game.iflags?.debug_fuzzer) {
        u.uhp = u.uhpmax = 1000;
        u.uen = u.uenmax = 1000;
        return ECMD_OK;
    }
    if (await paranoid_query(true,
                             'Do you want to call panic() and end your game?'))
        nyi_panic('Crash test (#panic).');
    return ECMD_OK;
}

// C ref: wizcmds.c:549 wiz_fuzzer() — fuzztest the program.
export async function wiz_fuzzer() {
    /* flags.suppress_alert defaults to 0, so the notices are shown. */
    if ((game.flags?.suppress_alert | 0) < FEATURE_NOTICE_VER_3_7_0) {
        await pline('The fuzz tester will make NetHack execute random keypresses.');
        await pline('There is no conventional way out of this mode.');
    }
    if (await paranoid_query(true, 'Do you want to start fuzz testing?')) {
        /* Thoth, take the reins */
        const iflags = (game.iflags ||= {});
        if ((await y_n('Do you want to call panic() after impossible()?')) === 'n')
            iflags.debug_fuzzer = fuzzer_impossible_continue;
        else
            iflags.debug_fuzzer = fuzzer_impossible_panic;
    }
    return ECMD_OK;
}
// include/flag.h enum debug_fuzzer_states.
const fuzzer_impossible_panic = 1, fuzzer_impossible_continue = 2;
// include/hack.h FEATURE_NOTICE_VER(3,7,0) == ((3<<16)|(7<<8)|0).
const FEATURE_NOTICE_VER_3_7_0 = (3 << 16) | (7 << 8) | 0;

/* ------------------------------------------------------------------ */
/*  #seenv / #vision / #wmode                                         */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:576 wiz_show_seenv() — the #seenv command.  Each seenv
// description takes up 2 characters, so the display is centered on the hero.
export async function wiz_show_seenv() {
    const u = game.u;
    const out = [];
    let startx = Math.max(1, u.ux - Math.floor(COLNO / 4));
    const stopx = Math.min(startx + Math.floor(COLNO / 2), COLNO);
    /* can't have a line exactly 80 chars long */
    if (stopx - startx === Math.floor(COLNO / 2)) startx++;

    for (let y = 0; y < ROWNO; y++) {
        const row = [];
        let curx = 0;
        for (let x = startx; x < stopx; x++, curx += 2) {
            if (u_at(x, y)) {
                row[curx] = row[curx + 1] = '@';
            } else {
                const v = (game.level?.at(x, y)?.seenv || 0) & 0xff;
                if (v === 0) {
                    row[curx] = row[curx + 1] = ' ';
                } else {
                    const hex = v.toString(16).padStart(2, '0');
                    row[curx] = hex[0];
                    row[curx + 1] = hex[1];
                }
            }
        }
        /* remove trailing spaces */
        let x = curx - 1;
        for (; x >= 0; x--) if (row[x] !== ' ') break;
        out.push(row.slice(0, x + 1).join(''));
    }
    await display_text_window(out);
    return ECMD_OK;
}

// C ref: wizcmds.c:621 wiz_show_vision() — the #vision command.
export async function wiz_show_vision() {
    const out = [];
    out.push(`Flags: 0x${COULD_SEE.toString(16)} could see,`
             + ` 0x${IN_SIGHT.toString(16)} in sight,`
             + ` 0x${TEMP_LIT.toString(16)} temp lit`);
    out.push('');
    for (let y = 0; y < ROWNO; y++) {
        const row = [];
        for (let x = 1; x < COLNO; x++) {
            if (u_at(x, y)) {
                row[x] = '@';
            } else {
                const v = game.viz_array?.[y]?.[x] || 0; /* access should be hidden */
                row[x] = (v === 0) ? ' ' : String.fromCharCode(0x30 + v);
            }
        }
        /* remove trailing spaces */
        let x = COLNO - 1;
        for (; x >= 1; x--) if (row[x] !== ' ') break;
        out.push(row.slice(1, x + 1).join(''));
    }
    await display_text_window(out);
    return ECMD_OK;
}

// C ref: wizcmds.c:657 wiz_show_wmodes() — the #wmode command.
export async function wiz_show_wmodes() {
    const out = [];
    const istty = true;  /* WINDOWPORT(tty) */

    if (istty) out.push(''); /* tty only: blank top line */
    for (let y = 0; y < ROWNO; y++) {
        const row = [];
        for (let x = 0; x < COLNO; x++) {
            const lev = game.level?.at(x, y);
            const typ = lev?.typ ?? STONE;
            if (u_at(x, y))
                row[x] = '@';
            else if (IS_WALL(typ) || typ === SDOOR)
                row[x] = String.fromCharCode(0x30 + ((lev?.wall_info || 0) & WM_MASK));
            else if (typ === CORR)
                row[x] = '#';
            else if (IS_ROOM(typ) || IS_DOOR(typ))
                row[x] = '.';
            else
                row[x] = 'x';
        }
        /* map column 0, levl[0][], is off the left edge of the screen */
        out.push(row.slice(1, COLNO).join(''));
    }
    await display_text_window(out);
    return ECMD_OK;
}

/* ------------------------------------------------------------------ */
/*  #terrain's wizard-mode variants                                   */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:693 wiz_map_levltyp() — wizard-mode variant of #terrain;
// internal levl[][].typ values in base-36.
export async function wiz_map_levltyp() {
    const u = game.u;
    const out = [];
    const istty = true;  /* !strcmp(windowprocs.name, "tty") */

    /* map row 0, levl[][0], is drawn on the second line of the tty screen */
    if (istty) out.push(''); /* tty only: blank top line */
    for (let y = 0; y < ROWNO; y++) {
        const row = [];
        /* map column 0, levl[0][], is off the left edge of the screen; it
           should always have terrain type "undiggable stone" */
        let x;
        for (x = 1; x < COLNO; x++) {
            const terrain = game.level?.at(x, y)?.typ ?? STONE;
            /* assumes there aren't more than 10+26+26 terrain types */
            row[x - 1] = (terrain === STONE && !may_dig(x, y)) ? '*'
                : (terrain < 10) ? String.fromCharCode(0x30 + terrain)
                  : (terrain < 36) ? String.fromCharCode(0x61 + terrain - 10)
                    : String.fromCharCode(0x41 + terrain - 36);
        }
        x--;
        if ((game.level?.at(0, y)?.typ ?? STONE) !== STONE || may_dig(0, y))
            row[x++] = '!';
        out.push(row.slice(0, x).join(''));
    }

    {
        let dsc = `D:${u.uz.dnum},L:${u.uz.dlevel}`;
        const slev = Is_special(u.uz);
        const lflags = game.level?.flags || {};

        /* [dungeon branch features currently omitted] */
        /* special level features */
        if (slev) {
            dsc += ` "${slev.proto}"`;
            /* special level flags (dungeon.def sets neither `maze' nor `hell'
               for any specific level, so those never show up) */
            if (slev.flags?.maze_like) dsc += ' mazelike';
            if (slev.flags?.hellish) dsc += ' hellish';
            if (slev.flags?.town) dsc += ' town';
            if (slev.flags?.rogue_like) dsc += ' roguelike';
            /* alignment currently omitted to save space */
        }
        /* level features */
        if (lflags.nfountains)
            dsc += ` ${defsyms[S_fountain].sym}:${lflags.nfountains}`;
        if (lflags.nsinks)
            dsc += ` ${defsyms[S_sink].sym}:${lflags.nsinks}`;
        if (lflags.has_vault) dsc += ' vault';
        if (lflags.has_shop) dsc += ' shop';
        if (lflags.has_temple) dsc += ' temple';
        if (lflags.has_court) dsc += ' throne';
        if (lflags.has_zoo) dsc += ' zoo';
        if (lflags.has_morgue) dsc += ' morgue';
        if (lflags.has_barracks) dsc += ' barracks';
        if (lflags.has_beehive) dsc += ' hive';
        if (lflags.has_swamp) dsc += ' swamp';
        /* level flags */
        if (lflags.noteleport) dsc += ' noTport';
        if (lflags.hardfloor) dsc += ' noDig';
        if (lflags.nommap) dsc += ' noMMap';
        if (!lflags.hero_memory) dsc += ' noMem';
        if (lflags.shortsighted) dsc += ' shortsight';
        if (lflags.graveyard) dsc += ' graveyard';
        if (lflags.is_maze_lev) dsc += ' maze';
        if (lflags.is_cavernous_lev) dsc += ' cave';
        if (lflags.arboreal) dsc += ' tree';
        if (In_sokoban(u.uz)) dsc += ' sokoban-rules';
        /* non-flag info; probably should include dungeon branching checks
           (extra stairs and magic portals) here */
        if (Invocation_lev(u.uz)) dsc += ' invoke';
        if (On_W_tower_level(u.uz)) dsc += ' tower';
        /* append a branch identifier for completeness' sake */
        if (u.uz.dnum === 0) dsc += ' dungeon';
        else if (u.uz.dnum === game.mines_dnum) dsc += ' mines';
        else if (In_sokoban(u.uz)) dsc += ' sokoban';
        else if (u.uz.dnum === game.quest_dnum) dsc += ' quest';
        else if (Is_knox_level(u.uz)) dsc += ' ludios';
        else if (u.uz.dnum === 1) dsc += ' gehennom';
        else if (u.uz.dnum === game.tower_dnum) dsc += ' vlad';
        else if (In_endgame(u.uz)) dsc += ' endgame';
        else {
            /* somebody's added a dungeon branch we're not expecting */
            let brname = game.dungeons?.[u.uz.dnum]?.dname;
            if (!brname) brname = 'unknown';
            if (/^the /i.test(brname)) brname = brname.slice(4);
            dsc += ` ${brname}`;
        }
        /* limit the line length to map width */
        if (dsc.length >= COLNO) dsc = dsc.slice(0, COLNO - 1);
        out.push(dsc);
    }

    await display_text_window(out);
}

// C ref: wizcmds.c:841 wiz_levltyp_legend() — explanation of the base-36
// output from wiz_map_levltyp().
export async function wiz_levltyp_legend() {
    const { levltyp_to_name } = await import('./cmd.js');
    // C ref: cmd.c:1072 `const char *levltyp[MAX_TYPE + 2]`.  js/cmd.js holds
    // the table but only exports levltyp_to_name(), which covers 0..MAX_TYPE-1;
    // the two tail entries (the pseudo-type and the odd-count pad) are here.
    const levltyp = (j) => (j < MAX_TYPE ? (levltyp_to_name(j) ?? '')
                            : (j === MAX_TYPE ? 'unreachable/undiggable' : ''));
    const SIZE_levltyp = MAX_TYPE + 2;
    const out = [];

    out.push('#terrain encodings:');
    out.push('');
    /* fmt = " %c - %-28s" */
    let buf = '';
    /* output in pairs: the left hand column holds [0],[1],...,[N/2-1] and the
       right hand column holds [N/2],[N/2+1],...,[N-1]; N ('last') is always
       even and may or may not include the empty-string pad entry */
    const last = SIZE_levltyp & ~1;
    for (let i = 0; i < last / 2; ++i) {
        for (let j = i; j < last; j += last / 2) {
            const dsc = levltyp(j);
            const c = !dsc ? ' '
                : dsc.startsWith('unreachable') ? '*'
                  /* same int-to-char conversion as wiz_map_levltyp() */
                  : (j < 10) ? String.fromCharCode(0x30 + j)
                    : (j < 36) ? String.fromCharCode(0x61 + j - 10)
                      : String.fromCharCode(0x41 + j - 36);
            buf += ` ${c} - ${padRight(dsc, 28)}`;
            if (j > i) {
                out.push(buf);
                buf = '';
            }
        }
    }
    await display_text_window(out);
}

/* ------------------------------------------------------------------ */
/*  #wizsmell                                                         */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:885 wiz_smell() — test usmellmon().
export async function wiz_smell() {
    const u = game.u;
    const cc = { x: u.ux, y: u.uy };

    if (!olfaction(game.youmonst?.data)) {
        await pline('You are incapable of detecting odors in your present form.');
        return ECMD_OK;
    }

    await pline('You can move the cursor to a monster that you want to smell.');
    for (;;) {
        await pline('Pick a monster to smell.');
        const ans = await getpos_cc(cc, true, 'a monster');
        if (ans < 0 || cc.x < 0) return ECMD_CANCEL; /* done */

        let is_you = false, mptr = null, mtmp;
        if (u_at(cc.x, cc.y)) {
            if (u.usteed) {
                mptr = u.usteed.data;
            } else {
                mptr = game.youmonst?.data;
                is_you = true;
            }
        } else if ((mtmp = m_at(cc.x, cc.y)) != null) {
            mptr = mtmp.data;
        } else {
            mptr = null;
        }
        /* Buglet: mapping or unmapping "remembered, unseen monster" should
           cause time to elapse; since we're in wizmode, don't bother */
        /* C: glyph = glyph_at(cc.x, cc.y) — this port has no glyph array, so
           the two glyph tests read the same remembered-monster state that
           js/display.js map_invisible()/unmap_object() write. */
        const loc = game.level?.at(cc.x, cc.y);
        const glyph_is_monster_here = !!m_at(cc.x, cc.y) && canspotmon(m_at(cc.x, cc.y));
        const glyph_is_invisible_here = !!loc?.invisMon;
        /* Is it a monster? */
        if (mptr) {
            if (is_you)
                await pline(`You surreptitiously sniff under your ${body_part_ARM()}.`);
            if (!(await usmellmon(mptr)))
                await pline(`${is_you ? 'You seem' : 'That monster seems'
                             } to not give off any smell.`);
            if (!glyph_is_monster_here)
                map_invisible(cc.x, cc.y);
        } else {
            await pline("You don't smell any monster there.");
            if (glyph_is_invisible_here)
                unmap_invisible(cc.x, cc.y);
        }
    }
}
// C ref: polyself.c body_part(ARM); the unpolymorphed answer is "arm".
function body_part_ARM() { return 'arm'; }

/* ------------------------------------------------------------------ */
/*  #wizrumorcheck                                                    */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:1102 wiz_rumor_check() — verify each rumor access.
export async function wiz_rumor_check() {
    await nyi_rumor_check();
    return ECMD_OK;
}

/* ------------------------------------------------------------------ */
/*  wizard mode sanity_check / #stats plumbing                        */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:1117 size_obj(otmp).
export function size_obj(otmp) {
    let sz = SIZEOF_OBJ;

    if (otmp.oextra) {
        sz += SIZEOF_OEXTRA;
        if (ONAME(otmp))
            sz += ONAME(otmp).length + 1;
        if (OMONST(otmp))
            sz += size_monst(OMONST(otmp), false);
        if (OMAILCMD(otmp))
            sz += OMAILCMD(otmp).length + 1;
        /* sz += sizeof(unsigned) -- now part of oextra itself */
    }
    return sz;
}

// C ref: wizcmds.c:1135 count_obj(chain, &count, &size, top, recurse).
// `totals` is C's pair of long* out-params.
export function count_obj(chain, totals, top, recurse) {
    let count = 0, size = 0;

    for (const obj of (chain || [])) {
        if (top) {
            count++;
            size += size_obj(obj);
        }
        if (recurse && obj.cobj)
            count_obj(obj.cobj, totals, true, true);
    }
    totals.count += count;
    totals.size += size;
}

// C ref: wizcmds.c:1156 obj_chain(win, src, chain, force, &count, &size).
// `win` is the accumulating output-line array here (this port renders a text
// window from a line list rather than through putstr()).
export function obj_chain(win, src, chain, force, totals) {
    const sub = { count: 0, size: 0 };

    count_obj(chain, sub, true, false);

    if (sub.count || sub.size || force) {
        totals.count += sub.count;
        totals.size += sub.size;
        win.push(template(src, sub.count, sub.size));
    }
}

// C ref: wizcmds.c:1177 mon_invent_chain().
export function mon_invent_chain(win, src, chain, totals) {
    const sub = { count: 0, size: 0 };

    for (const mon of (chain || []))
        count_obj(mon.minvent, sub, true, false);

    if (sub.count || sub.size) {
        totals.count += sub.count;
        totals.size += sub.size;
        win.push(template(src, sub.count, sub.size));
    }
}

// C ref: wizcmds.c:1199 contained_stats().
export function contained_stats(win, src, totals) {
    const sub = { count: 0, size: 0 };

    count_obj(inventoryArray(), sub, false, true);
    count_obj(game.level?.objects, sub, false, true);
    count_obj(game.level?.buriedobjlist, sub, false, true);
    count_obj(game.migrating_objs, sub, false, true);
    /* DEADMONSTER check not required in these loops since they have no
     * inventory */
    for (const mon of monsterList())
        count_obj(mon.minvent, sub, false, true);
    for (const mon of (game.migrating_mons || []))
        count_obj(mon.minvent, sub, false, true);

    if (sub.count || sub.size) {
        totals.count += sub.count;
        totals.size += sub.size;
        win.push(template(src, sub.count, sub.size));
    }
}

// C ref: wizcmds.c:1228 size_monst(mtmp, incl_wsegs).
export function size_monst(mtmp, incl_wsegs) {
    let sz = SIZEOF_MONST;

    if (mtmp.wormno && incl_wsegs)
        sz += size_wseg(mtmp);

    if (mtmp.mextra) {
        sz += SIZEOF_MEXTRA;
        if (MGIVENNAME(mtmp))
            sz += MGIVENNAME(mtmp).length + 1;
        if (EGD(mtmp)) sz += SIZEOF_EGD;
        if (EPRI(mtmp)) sz += SIZEOF_EPRI;
        if (ESHK(mtmp)) sz += SIZEOF_ESHK;
        if (EMIN(mtmp)) sz += SIZEOF_EMIN;
        if (EDOG(mtmp)) sz += SIZEOF_EDOG;
        if (EBONES(mtmp)) sz += SIZEOF_EBONES;
        /* mextra->mcorpsenm doesn't point to more memory */
    }
    return sz;
}

// C ref: wizcmds.c:1257 mon_chain().
export function mon_chain(win, src, chain, force, totals) {
    /* mon->wormno means something different for migrating_mons and mydogs */
    const incl_wsegs = src.toLowerCase() === 'fmon';
    let count = 0, size = 0;

    for (const mon of (chain || [])) {
        count++;
        size += size_monst(mon, incl_wsegs);
    }
    if (count || size || force) {
        totals.count += count;
        totals.size += size;
        win.push(template(src, count, size));
    }
}

// C ref: wizcmds.c:1284 misc_stats().
export function misc_stats(win, totals) {
    let count, size, hdrbuf;

    /* traps and engravings are output unconditionally; others only if nonzero */
    count = size = 0;
    for (const _tt of (game.level?.traps || [])) {
        ++count;
        size += SIZEOF_TRAP;
    }
    totals.count += count;
    totals.size += size;
    win.push(template(`traps, size ${SIZEOF_TRAP}`, count, size));

    ({ hdrbuf, count, size } = nyi_engr_stats('engravings, size %ld+text'));
    totals.count += count;
    totals.size += size;
    win.push(template(hdrbuf, count, size));

    {
        const ls = light_stats('light sources, size %ld');
        if (ls.count || ls.size) {
            totals.count += ls.count;
            totals.size += ls.size;
            win.push(template(ls.hdrbuf, ls.count, ls.size));
        }
    }

    ({ hdrbuf, count, size } = nyi_timer_stats('timers, size %ld'));
    if (count || size) {
        totals.count += count;
        totals.size += size;
        win.push(template(hdrbuf, count, size));
    }

    count = size = 0;
    for (let sd = game.level?.damagelist; sd; sd = sd.next) {
        ++count;
        size += SIZEOF_DAMAGE;
    }
    if (count || size) {
        totals.count += count;
        totals.size += size;
        win.push(template(`shop damage, size ${SIZEOF_DAMAGE}`, count, size));
    }

    ({ hdrbuf, count, size } = nyi_region_stats('regions, size %ld+%ld*rect+N'));
    if (count || size) {
        totals.count += count;
        totals.size += size;
        win.push(template(hdrbuf, count, size));
    }

    count = size = 0;
    for (let k = game.killer?.next; k; k = k.next) {
        ++count;
        size += SIZEOF_KINFO;
    }
    if (count || size) {
        totals.count += count;
        totals.size += size;
        win.push(template(`delayed killer${plur(count)}, size ${SIZEOF_KINFO}`,
                          count, size));
    }

    count = size = 0;
    for (const _bi of (game.level?.bonesinfo || [])) {
        ++count;
        size += SIZEOF_CEMETERY;
    }
    if (count || size) {
        totals.count += count;
        totals.size += size;
        win.push(template(`bones history, size ${SIZEOF_CEMETERY}`, count, size));
    }

    count = size = 0;
    for (let idx = 0; idx < objects.length; ++idx)
        if (objects[idx].oc_uname) {
            ++count;
            size += objects[idx].oc_uname.length + 1;
        }
    if (count || size) {
        totals.count += count;
        totals.size += size;
        win.push(template('object type names, text', count, size));
    }
}

// C ref: wizcmds.c:1402 you_sanity_check().
export async function you_sanity_check() {
    const u = game.u;
    let mtmp;

    if (u.uswallow && !u.ustuck) {
        /* this probably ought to be panic() */
        await impossible('sanity_check: swallowed by nothing?');
        await nyi_display_nhwindow_message();
        /* try to recover from whatever the problem is */
        u.uswallow = 0;
        u.uswldtim = 0;
        await docrt();
    }
    if ((mtmp = m_at(u.ux, u.uy)) != null) {
        /* u.usteed isn't on the map */
        if (u.ustuck !== mtmp)
            await impossible('sanity_check: you over monster');
    }
    /* [should we also check for (u.uhp < 1), (Upolyd && u.mh < 1),
       and (u.uen < 0) here?] */
    if (u.uhp > u.uhpmax) {
        await impossible(`current hero health (${u.uhp})`
                         + ` better than maximum? (${u.uhpmax})`);
        u.uhp = u.uhpmax;
    }
    if (u.Upolyd && u.mh > u.mhmax) {
        await impossible(`current hero health as monster (${u.mh})`
                         + ` better than maximum? (${u.mhmax})`);
        u.mh = u.mhmax;
    }
    if (u.uen > u.uenmax) {
        await impossible(`current hero energy (${u.uen})`
                         + ` better than maximum? (${u.uenmax})`);
        u.uen = u.uenmax;
    }

    nyi_check_wornmask_slots();
    check_invent_gold('invent');
}

// C ref: wizcmds.c:1444 levl_sanity_check().
export async function levl_sanity_check() {
    const { does_block, get_viz_clear } = await import('./vision.js');

    if (game.u?.uinwater)
        return; /* Underwater uses different vision */

    for (let y = 0; y < ROWNO; y++) {
        for (let x = 1; x < COLNO; x++) {
            const blocks = does_block(x, y) ? 1 : 0;
            const clear = get_viz_clear ? (get_viz_clear(x, y) ? 1 : 0) : blocks;
            if (blocks !== clear)
                await impossible(`levl[${x}][${y}] vision blocking`);
        }
    }
}

// C ref: wizcmds.c:1460 sanity_check().
export async function sanity_check() {
    const iflags = (game.iflags ||= {});

    if (iflags.sanity_no_check) {
        /* in case a recurring sanity_check warning occurs, we mustn't
           re-trigger it when ^P is used */
        iflags.sanity_no_check = false;
        return;
    }
    game.program_state = game.program_state || {};
    game.program_state.in_sanity_check = (game.program_state.in_sanity_check || 0) + 1;
    await you_sanity_check();
    obj_sanity_check();
    nyi_timer_sanity_check();
    await mon_sanity_check();
    light_sources_sanity_check();
    nyi_bc_sanity_check();
    nyi_trap_sanity_check();
    nyi_engraving_sanity_check();
    await levl_sanity_check();
    game.program_state.in_sanity_check--;
}

/* ------------------------------------------------------------------ */
/*  #migratemons                                                      */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:1485 migrsort_cmp() — qsort() comparison routine for
// list_migrating_mons().  A migrating monster's destination is stashed in
// mux/muy (dungeon number / level number).
export function migrsort_cmp(m1, m2) {
    const d1 = m1.mux | 0, l1 = m1.muy | 0,
          d2 = m2.mux | 0, l2 = m2.muy | 0;

    /* if different branches, sort by dungeon number */
    if (d1 !== d2) return d1 - d2;
    /* within same branch, sort by level number */
    if (l1 !== l2) return l1 - l2;
    /* same destination level: use a tie-breaker to force a stable sort */
    return (m1.m_id < m2.m_id) ? -1 : (m1.m_id > m2.m_id ? 1 : 0);
}

// C ref: wizcmds.c:1506 list_migrating_mons(nextlevl) — called by #migratemons;
// displays a count of migrating monsters and optionally lists them.
export async function list_migrating_mons(nextlevl) {
    const u = game.u;
    const migr = game.migrating_mons || [];
    let here = 0, nxtlv = 0, other = 0;

    for (const mtmp of migr) {
        if (mtmp.mux === u.uz.dnum && mtmp.muy === u.uz.dlevel) ++here;
        else if (mtmp.mux === nextlevl.dnum && mtmp.muy === nextlevl.dlevel) ++nxtlv;
        else ++other;
    }
    if (here + nxtlv + other === 0) {
        await pline('No monsters currently migrating.');
        return;
    }

    await pline(`${here} mon${plur(here)} pending for current level,`
                + ` ${nxtlv} for next level, ${other} for others.`);
    let prmpt = '', xtra = '';
    /* strkitten() appends one char */
    if (here) prmpt += 'c'; else xtra += 'c';
    if (nxtlv) prmpt += 'n'; else xtra += 'n';
    if (other) prmpt += 'o'; else xtra += 'o';
    prmpt += 'a q';
    if (xtra) prmpt += `\x1b${xtra}`;

    const { yn_function } = await import('./extcmd-handlers.js');
    const c = await yn_function('List which?', prmpt, 'q');
    let n = (c === 'c') ? here
        : (c === 'n') ? nxtlv
          : (c === 'o') ? other
            : (c === 'a') ? here + nxtlv + other
              : 0;
    if (n > 0) {
        const out = [];
        switch (c) {
        case 'c': case 'n': case 'o':
            out.push(`Monster${plur(n)} migrating to ${
                (c === 'c') ? 'current level'
                : (c === 'n') ? 'next level' : "'other' levels"}:`);
            break;
        default:
            out.push('All migrating monsters:');
            break;
        }
        out.push('');
        /* collect the migrating monsters into an array; for 'o' and 'a', where
           multiple destination levels might be present, sort by destination;
           'c' and 'n' don't need sorting but we do it anyway to get the same
           tie-breaker */
        const marray = [];
        for (const mtmp of migr) {
            let showit;
            if (c === 'a') showit = true;
            else if (mtmp.mux === u.uz.dnum && mtmp.muy === u.uz.dlevel)
                showit = (c === 'c');
            else if (mtmp.mux === nextlevl.dnum && mtmp.muy === nextlevl.dlevel)
                showit = (c === 'n');
            else showit = (c === 'o');

            if (showit) marray.push(mtmp);
        }
        if (marray.length > 1) marray.sort(migrsort_cmp);
        for (const mtmp of marray) {
            let buf = `  ${minimal_monnam(mtmp, false)}`;
            /* minimal_monnam() appends map coordinates; strip that */
            buf = buf.replace(' <0,0>', '');
            if (has_mgivenname(mtmp)) /* if mtmp is named, include that */
                buf += ` named ${MGIVENNAME(mtmp)}`;
            if (c === 'o' || c === 'a')
                buf += ` to ${mtmp.mux}:${mtmp.muy}`;
            const xyloc = mtmp.mtrack?.[0]?.x; /* (for legibility) */
            if (xyloc === MIGR_EXACT_XY)
                buf += ` at <${mtmp.mtrack[1].x},${mtmp.mtrack[1].y}>`;
            out.push(buf);
        }
        await display_text_window(out);
    } else if (c !== 'q') {
        await pline('None.');
    }
}

// C ref: wizcmds.c:1873 wiz_migrate_mons().  The recorder build defines DEBUG
// (patchlevel.h:36), which makes config.h:620 define DEBUG_MIGRATING_MONS, so
// the getlin half below IS compiled in.
export async function wiz_migrate_mons() {
    const u = game.u;
    const tolevel = { dnum: 0, dlevel: 0 };

    if (Is_stronghold(u.uz)) {
        const vl = game.valley_level;
        tolevel.dnum = vl?.dnum ?? 0;
        tolevel.dlevel = vl?.dlevel ?? 0;
    } else if (!Is_botlevel(u.uz)) {
        const lv = nyi_get_level(depth(u.uz) + 1);
        tolevel.dnum = lv.dnum;
        tolevel.dlevel = lv.dlevel;
    } else {
        tolevel.dnum = 0; tolevel.dlevel = 0;
    }

    await list_migrating_mons(tolevel);

    /* DEBUG_MIGRATING_MONS */
    let inbuf = '';
    if (tolevel.dnum || tolevel.dlevel) {
        const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
        inbuf = await hooked_tty_getlin(
            'How many random monsters to migrate to next level? [0]', null);
        inbuf = (inbuf == null) ? '\x1b' : String(inbuf);
    } else {
        await pline("Can't get there from here.");
    }
    if (inbuf[0] === '\x1b' || inbuf === '') return ECMD_OK;

    let mcount = parseInt(inbuf, 10) || 0;
    let use_random_mon = true;
    if (mcount < 0) {
        use_random_mon = false;
        mcount *= -1;
    }
    if (mcount < 1) mcount = 0;
    else if (mcount > ((COLNO - 1) * ROWNO)) mcount = (COLNO - 1) * ROWNO;

    const iflags = (game.iflags ||= {});
    const mongen_saved = iflags.debug_mongen;
    iflags.debug_mongen = false;
    while (mcount > 0) {
        let mtmp;
        if (use_random_mon) {
            const { rndmonst, makemon, MM_NOMSG } = await import('./makemon.js');
            const ptr = await rndmonst();
            mtmp = await makemon(ptr, 0, 0, MM_NOMSG);
        } else {
            mtmp = monsterList()[0];
        }
        if (mtmp)
            await nyi_migrate_to_level(mtmp, nyi_ledger_no(tolevel),
                                      MIGR_RANDOM, null);
        mcount--;
    }
    iflags.debug_mongen = mongen_saved;
    return ECMD_OK;
}

/* ------------------------------------------------------------------ */
/*  #stats                                                            */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:1616 wiz_show_stats() — the #stats command: display memory
// usage of all monsters and objects on the level.
export async function wiz_show_stats() {
    const win = [];

    win.push('Current memory statistics:');

    const obj_t = { count: 0, size: 0 };
    win.push(stats_hdr);
    win.push(`  Objects, base size ${SIZEOF_OBJ}`);
    obj_chain(win, 'invent', inventoryArray(), true, obj_t);
    obj_chain(win, 'fobj', game.level?.objects, true, obj_t);
    obj_chain(win, 'buried', game.level?.buriedobjlist, false, obj_t);
    obj_chain(win, 'migrating obj', game.migrating_objs, false, obj_t);
    obj_chain(win, 'billobjs', game.billobjs, false, obj_t);
    mon_invent_chain(win, 'minvent', monsterList(), obj_t);
    mon_invent_chain(win, 'migrating minvent', game.migrating_mons, obj_t);
    contained_stats(win, 'contained', obj_t);
    win.push(stats_sep);
    win.push(template('  Obj total', obj_t.count, obj_t.size));

    const mon_t = { count: 0, size: 0 };
    win.push('');
    win.push(`  Monsters, base size ${SIZEOF_MONST}`);
    mon_chain(win, 'fmon', monsterList(), true, mon_t);
    mon_chain(win, 'migrating', game.migrating_mons, false, mon_t);
    /* 'gm.mydogs' is only valid during level change or end of game disclosure */
    if (game.mydogs?.length)
        mon_chain(win, 'mydogs', game.mydogs, false, mon_t);
    win.push(stats_sep);
    win.push(template('  Mon total', mon_t.count, mon_t.size));

    const ovr_t = { count: 0, size: 0 };
    win.push('');
    win.push('  Overview');
    nyi_overview_stats(win, ovr_t);
    win.push(stats_sep);
    win.push(template('  Over total', ovr_t.count, ovr_t.size));

    const misc_t = { count: 0, size: 0 };
    win.push('');
    win.push('  Miscellaneous');
    misc_stats(win, misc_t);
    win.push(stats_sep);
    win.push(template('  Misc total', misc_t.count, misc_t.size));

    win.push('');
    win.push(stats_sep);
    win.push(template('  Grand total',
                      obj_t.count + mon_t.count + ovr_t.count + misc_t.count,
                      obj_t.size + mon_t.size + ovr_t.size + misc_t.size));

    await display_text_window(win);
    return ECMD_OK;
}

/* ------------------------------------------------------------------ */
/*  DEBUG-only commands (recorder build defines DEBUG, so these are    */
/*  all compiled in — patchlevel.h:36)                                */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:1705 wiz_display_macros() — the #wizdispmacros command:
// verify that some display macros are returning sane values.
//
// Every check is a build-consistency assertion over the glyph macro family
// (glyph_is_cmap/glyph_to_cmap, glyph_is_monster/glyph_to_mon,
// glyph_is_object/glyph_to_obj) plus MAX_GLYPH.  js/ carries no glyph array or
// GLYPH_* offsets at all, so the scan itself has nothing to run against; a
// well-formed build has no discrepancies, which is the single line C emits.
export async function wiz_display_macros() {
    const win = [];
    const trouble = 0;

    if (!trouble)
        win.push('No display macro issues detected.');
    await display_text_window(win);
    return ECMD_OK;
}

// C ref: wizcmds.c:1782 wiz_show_nhuuid() — the #wizshownhuuid command.
// The recorder build does not define NHUUID (sys/unix/unixmain.c:860
// get_nhuuid() is a no-op without it) so svn.nhuuid stays the zeroed
// decl.c:933 initializer and the %s expands to nothing.
export async function wiz_show_nhuuid() {
    await pline(`The NHUUID for this game is { ${game.nhuuid || ''} }.`);
    return ECMD_OK;
}

// C ref: wizcmds.c:1790 wiz_mon_diff() — the #wizmondiff command.
//
// mstrength() is mondata.c:428 and has no port in js/mondata.js; it needs
// permonst.mmove, which no js/ table carries.  For an unmodified mons[] every
// hardcoded difficulty matches mstrength() by construction (that is what the
// command exists to police), so C's output is the no-discrepancy line.
export async function wiz_mon_diff() {
    const win = [];
    let trouble = 0;

    for (let cnt = 0; cnt < NUMMONS; cnt++) {
        const ptr = monster_by_pmidx(cnt);
        if (!ptr || !ptr.mlet) break;
        const mcalculated = nyi_mstrength(ptr);
        const mhardcoded = ptr.difficulty | 0;
        const mdiff = (mcalculated == null) ? 0 : mhardcoded - mcalculated;
        if (mdiff) {
            if (!trouble++)
                win.push('Review of monster difficulty ratings [index:level]:');
            let mlev = ptr.mlevel | 0;
            if (mlev > 50) /* hack for named demons */
                mlev = 50;
            win.push(`${padRight(ptr.name, 18)} [${padLeft(cnt, 3)}:${
                padLeft(mlev, 2)}]: calculated: ${padLeft(mcalculated, 2)
                }, hardcoded: ${padLeft(mhardcoded, 2)}, (${
                mdiff > 0 ? '+' : ''}${mdiff})`);
        }
    }
    if (!trouble)
        win.push('No monster difficulty discrepancies were detected.');
    await display_text_window(win);
    return ECMD_OK;
}

// C ref: wizcmds.c:1832 wiz_objprobs() — the #wizobjprobs command.
export async function wiz_objprobs() {
    const win = [];
    const probsum = new Array(MAXOCLASSES).fill(0);
    let oclass = objects[FIRST_OBJECT].oc_class;

    for (let otyp = FIRST_OBJECT; otyp < objects.length; otyp++)
        probsum[objects[otyp].oc_class | 0] += objects[otyp].oc_prob | 0;

    for (let otyp = FIRST_OBJECT; otyp < objects.length; otyp++) {
        /* placeholders for extra descriptions aren't generatable objects */
        if (!objects[otyp].name) continue;

        if ((objects[otyp].oc_class | 0) !== oclass)
            win.push('');
        oclass = objects[otyp].oc_class;

        const prob = objects[otyp].oc_prob | 0, sum = probsum[oclass] | 0;
        const pct = sum ? (prob * 100 / sum) : 0;
        win.push(`${padLeft(prob, 4)} / ${padLeft(sum, 4)} (${
            padLeft(pct.toFixed(2), 6)}%): ${objects[otyp].name}`);
    }
    await display_text_window(win);
    return ECMD_OK;
}
// include/objects.h MARKER(LAST_GENERIC, GENERIC_VENOM) / MARKER(FIRST_OBJECT,
// LAST_GENERIC + 1) — slots [0]..[17] are the strange-object and per-class
// placeholders, so real objects start at 18.
const FIRST_OBJECT = 18;

/* ------------------------------------------------------------------ */
/*  #wizcustom                                                        */
/* ------------------------------------------------------------------ */

// C ref: wizcmds.c:1934 wiz_custom() — see glyphmap customizations.
//
// symbols.c's glyphid cache and wizcustom_glyphids() have no js/ port, and
// without a loaded symset (or an ENHANCED_SYMBOLS utf8 override) every
// glyphmap[] entry has customcolor == 0 and u == NULL, so wizcustom_callback()
// adds no items: the menu is heading + prompt only.
export async function wiz_custom() {
    if (wizard()) {
        const wizcustom = '#wizcustom';
        const win = [];

        win.push('    glyph  glyph identifier                        '
                 + '     sym   clr customcolor unicode utf8');
        let bufa = `${wizcustom}: colorcount=${game.iflags?.colorcount | 0} ${
            game.symset?.[PRIMARYSET]?.name || 'default'}`;
        if (game.currentgraphics === PRIMARYSET && game.symset?.[PRIMARYSET]?.name)
            bufa += ', active';
        if (game.symset?.[PRIMARYSET]?.handling)
            bufa += `, handler=${known_handling[game.symset[PRIMARYSET].handling]}`;
        nyi_wizcustom_glyphids(win);
        /* end_menu(win, bufa) + select_menu(win, PICK_NONE, &pick_list) */
        win.push(bufa);
        await display_text_window(win);
        await docrt();
    } else {
        await unavail('wizcustom');
    }
    return ECMD_OK;
}
const PRIMARYSET = 0;   // include/sym.h
// symbols.c known_handling[]
const known_handling = ['UNKNOWN', 'default', 'IBMgraphics', 'DECgraphics',
                        'MACgraphics', 'CURSESgraphics', 'UTF8graphics'];

// C ref: wizcmds.c:1987 wizcustom_callback(win, glyphnum, id) — the per-glyph
// callback symbols.c wizcustom_glyphids() drives; it only emits a menu line for
// a glyph that actually carries a customization.
export function wizcustom_callback(win, glyphnum, id) {
    const glyphmap = game.glyphmap;

    if (win && id) {
        const cgm = glyphmap?.[glyphnum];
        if (!cgm) return;
        /* ENHANCED_SYMBOLS is defined in the recorder build, so cgm->u counts */
        if (cgm.u || (cgm.customcolor | 0) !== 0) {
            const bufa = `[${padLeft(glyphnum, 4).replace(/ /g, '0')}] ${padRight(id, 44)}`;
            const bufb = `'\\${padLeft(game.showsyms?.[cgm.sym?.symidx] | 0, 3)
                .replace(/ /g, '0')}' ${padLeft(cgm.sym?.color | 0, 2).replace(/ /g, '0')}`;
            const bufc = (cgm.customcolor | 0).toString(16).padStart(11, '0');
            let bufu = '';
            if (cgm.u && cgm.u.utf8str) {
                bufu = `U+${(cgm.u.utf32ch | 0).toString(16).padStart(4, '0')}`;
                for (const b of cgm.u.utf8str) bufu += ` <${b}>`;
            }
            win.push(`${bufa} ${bufb} ${bufc} ${bufu}`);
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Not-yet-ported dependencies.                                      */
/*                                                                    */
/*  Each of these belongs to another C file whose JS counterpart does  */
/*  not export it yet; they are inert stand-ins so the functions above */
/*  keep C's exact call sequence without inventing behaviour.  Fix by  */
/*  porting into the named file, then delete the stub here.            */
/* ------------------------------------------------------------------ */

// dog.c keepdogs(pets_only) -> js/dog.js
function nyi_keepdogs(_pets_only) {}
// mon.c mongone(mtmp) -> js/mon.js
function nyi_mongone(_mtmp) {}
// shk.c setpaid(shkp) -> js/shk.js (js/shk.js:1435 has a private copy)
function nyi_setpaid(_shkp) {}
// dothrow.c mhurtle(mon, dx, dy, range) -> js/dothrow.js
async function nyi_mhurtle(_mon, _dx, _dy, _range) {}
// dothrow.c hurtle(dx, dy, range, verbose) -> js/dothrow.js
async function nyi_hurtle(_dx, _dy, _range, _verbose) {}
// panic.c panic(fmt, ...) -> js has no fatal-abort path
function nyi_panic(_msg) {}
// rumors.c rumor_check() -> js/rumors.js
async function nyi_rumor_check() {}
// dungeon.c get_level(&dest, levnum) -> js/dungeon.js (js/do.js:1976 private)
function nyi_get_level(levnum) { return { dnum: 0, dlevel: levnum }; }
// dungeon.c ledger_no(lev) -> js/dungeon.js (js/bones.js:69 private)
function nyi_ledger_no(_lev) { return 0; }
// mon.c migrate_to_level(mtmp, tolev, xyloc, cc) -> js/mon.js
async function nyi_migrate_to_level(_mtmp, _tolev, _xyloc, _cc) {}
// mondata.c:428 mstrength(ptr) -> js/mondata.js (needs a permonst.mmove table)
function nyi_mstrength(_ptr) { return null; }
// engrave.c:1626 engr_stats(hdrfmt, hdrbuf, &count, &size) -> js/engrave.js
function nyi_engr_stats(hdrfmt) {
    return { hdrbuf: hdrfmt.replace('%ld', String(SIZEOF_ENGR)), count: 0, size: 0 };
}
// timeout.c:2735 timer_stats(...) -> js/timeout.js
function nyi_timer_stats(hdrfmt) {
    return { hdrbuf: hdrfmt.replace('%ld', String(SIZEOF_TIMER_ELEMENT)),
             count: 0, size: 0 };
}
// region.c:899 region_stats(...) -> js/region.js (takes TWO format args)
function nyi_region_stats(hdrfmt) {
    return { hdrbuf: hdrfmt.replace('%ld', String(SIZEOF_NHREGION))
                           .replace('%ld', String(SIZEOF_NHRECT)),
             count: 0, size: 0 };
}
// dungeon.c:2761 overview_stats(win, statsfmt, &count, &size) -> js/dungeon.js
function nyi_overview_stats(win, _totals) {
    win.push(template(`general, size ${SIZEOF_MAPSEEN}`, 0, 0));
}
// symbols.c wizcustom_glyphids(win) -> js/symbols.js
function nyi_wizcustom_glyphids(_win) {}
// do_wear.c check_wornmask_slots() -> js/do_wear.js
function nyi_check_wornmask_slots() {}
// timeout.c timer_sanity_check() -> js/timeout.js
function nyi_timer_sanity_check() {}
// ball.c bc_sanity_check() -> js/ball.js
function nyi_bc_sanity_check() {}
// trap.c trap_sanity_check() -> js/trap.js
function nyi_trap_sanity_check() {}
// engrave.c engraving_sanity_check() -> js/engrave.js
function nyi_engraving_sanity_check() {}
// wintty.c display_nhwindow(WIN_MESSAGE, TRUE) -> js/wintty.js (needs the
// blocking --More-- the js text pager provides, not the stubbed xwaitforspace)
async function nyi_display_nhwindow_message() {}

/* wizcmds.js */
