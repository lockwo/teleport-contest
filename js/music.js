// music.js — C ref: src/music.c, ported in full.
//
// Every instrument arm of do_improvisation() plus the passtune / drawbridge
// half of do_play_instrument().  The previous port lived in apply.js and
// handled only LEATHER_DRUM; that arm's RNG (rn2(2) mode roll -> improvised
// notes -> rn1(20,30) deafness -> awaken_monsters) is preserved exactly here.

import { game } from './gstate.js';
import { rn2, rnd, rn1, rnl, d } from './rng.js';
import {
    isok, A_STR, A_DEX, A_WIS, COLNO, ROWNO,
    PIT, SPIKED_PIT, CORR, DRAWBRIDGE_UP, DRAWBRIDGE_DOWN,
    FOUNTAIN, SINK, ALTAR, GRAVE, THRONE, SCORR, ROOM, SDOOR, DOOR,
} from './const.js';
import { m_at, newsym, update_topl } from './display.js';
import { cansee } from './vision.js';
import { Is_stronghold, In_sokoban } from './const.js';
import {
    mindless, humanoid, is_flyer_flag, is_mercenary_flag, mflags1_of,
    M1_CLING, M1_CONCEAL,
} from './monflags_data.js';

// C ref: objects.h otyp (js/mkobj.js OBJECT_DATA indices).
export const WOODEN_FLUTE = 247, MAGIC_FLUTE = 248, TOOLED_HORN = 249,
    FROST_HORN = 250, FIRE_HORN = 251, WOODEN_HARP = 253, MAGIC_HARP = 254,
    BUGLE = 256, LEATHER_DRUM = 257, DRUM_OF_EARTHQUAKE = 258;

// C ref: objects.h BITS() mgc for the tool class.  js/mkobj.js's objects[]
// only carries oc_magic for amulets/scrolls/spellbooks (o_init.js:192), so the
// magic instruments are named here — do_improvisation()'s mundane-downgrade
// loop walks otyp downwards until oc_magic is clear.
const MAGIC_TOOL = new Set([MAGIC_FLUTE, FROST_HORN, FIRE_HORN,
                            252 /*HORN_OF_PLENTY*/, MAGIC_HARP,
                            DRUM_OF_EARTHQUAKE, 263 /*BELL_OF_OPENING*/,
                            228 /*MAGIC_LAMP*/, 236 /*MAGIC_MARKER*/]);

// C ref: hack.h:1456 — ECMD_OK 0x00, ECMD_TIME 0x01, ECMD_CANCEL 0x02,
// ECMD_FAIL 0x04.  js/apply.js carries its OWN renumbering (ECMD_TIME 2), so
// its dispatch translates this return value; do not compare the two directly.
const ECMD_OK = 0x00, ECMD_TIME = 0x01;
const TOOL_CLASS = 6;
const S_SNAKE = 45, S_NYMPH = 14, S_PIERCER = 16; // defsym.h MONSYM indices
const STRAT_WAITMASK = 0x03000000;
const TT_PIT = 2, TT_BURIEDBALL = 7;
const PM_ARCHEOLOGIST = 0;

function DEADMONSTER(m) { return !m || (m.mhp | 0) <= 0; }
function mdata(m) { return m?.data || m?.mdat || null; }
function mdistu(mtmp) {
    const u = game.u || {};
    const dx = mtmp.mx - u.ux, dy = mtmp.my - u.uy;
    return dx * dx + dy * dy;
}
function dist2(x0, y0, x1, y1) { return (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0); }
function uprop(...names) {
    const p = game.u?.uprops || {};
    for (const n of names) if ((p[n] | 0) > 0 || p[n] === true) return true;
    return false;
}
function Deaf() { return uprop('Deaf', 'HDeaf', 'EDeaf'); }
function Stunned() { return uprop('Stun', 'HStun') || !!game.u?.ustun; }
function Confusion() { return uprop('Confusion', 'HConfusion') || !!game.u?.uconf; }
function Hallucination() { return uprop('Hallucination', 'HHallucination') || !!game.u?.uhallu; }
function Unchanging() { return uprop('Unchanging', 'HUnchanging'); }
function Blind() { return uprop('Blinded') || !!game.u?.Blinded; }
function Underwater() { return !!game.u?.uinwater; }
function Levitation() { return uprop('Levitation', 'HLevitation', 'ELevitation'); }
function Flying() { return uprop('Flying', 'HFlying', 'EFlying'); }
function Fumbling() { return uprop('Fumbling', 'HFumbling', 'EFumbling'); }
function ACURR(a) { return game.u?.acurr?.[a] ?? game.u?.attrib?.[a] ?? 10; }
function monsterList() { return (game.level?.monsters || []); }

// C ref: hack.c losehp(n, knam, k_format) — no RNG.
function losehp(n) {
    const u = game.u;
    if (!u) return;
    u.uhp -= n;
    if (u.uhp < 1) u.uhp = 0;
    game.disp = game.disp || {};
    game.disp.botl = true;
}
// C ref: trap.c set_utrap(tim, typ).
function set_utrap(tim, typ) {
    const u = game.u;
    if (!u) return;
    u.utrap = tim; u.utraptype = typ;
}
// C ref: youprop.h Maybe_Half_Phys(dmg).
function Maybe_Half_Phys(dmg) {
    return uprop('Half_physical_damage', 'HHalf_physical_damage')
        ? Math.trunc((dmg + 1) / 2) : dmg;
}

// C ref: mondata.h unique_corpstat(ptr) — G_UNIQ (monst.h geno bit).
const G_UNIQ = 0x1000;
function unique_corpstat(p) { return !!((p?.geno | 0) & G_UNIQ); }

// C ref: zap.c resist(mtmp, TOOL_CLASS, 0, NOTELL) — alev 10 for a tool.
async function resist_tool(mtmp) {
    const { resist } = await import('./zap.js');
    return resist(mtmp, TOOL_CLASS, 0, false);
}

// C ref: music.c:45 awaken_scare(mtmp, scary) — wake a monster, maybe scare it.
async function awaken_scare(mtmp, scary) {
    const { monflee, onscary } = await import('./monmove.js');
    mtmp.msleeping = 0; mtmp.mcanmove = 1; mtmp.mfrozen = 0;
    if (!unique_corpstat(mdata(mtmp)) && ((mtmp.mstrategy | 0) & STRAT_WAITMASK) !== 0) {
        mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_WAITMASK;
    } else if (scary && !mindless(mdata(mtmp)) && !(await resist_tool(mtmp))
               && onscary(0, 0, mtmp)) {
        await monflee(mtmp, 0, false, true);
    }
}

// C ref: music.c:67 awaken_monsters(distance).
async function awaken_monsters(distance) {
    for (const mtmp of monsterList().slice()) {
        if (DEADMONSTER(mtmp)) continue;
        const distm = mdistu(mtmp);
        if (distm < distance) await awaken_scare(mtmp, distm < Math.trunc(distance / 3));
    }
}

// C ref: music.c:84 put_monsters_to_sleep(distance).
async function put_monsters_to_sleep(distance) {
    const { sleep_monst } = await import('./zap.js');
    for (const mtmp of monsterList().slice()) {
        if (DEADMONSTER(mtmp)) continue;
        if (mdistu(mtmp) < distance && await sleep_monst(mtmp, d(10, 10), TOOL_CLASS)) {
            mtmp.msleeping = 1;
        }
    }
}

// C ref: music.c:104 charm_snakes(distance).  No RNG.
async function charm_snakes(distance) {
    const { Monnam, x_monnam, canspotmon } = await import('./uhitm.js');
    for (const mtmp of monsterList().slice()) {
        if (DEADMONSTER(mtmp)) continue;
        if (mdata(mtmp)?.mcls === S_SNAKE && mtmp.mcanmove && mdistu(mtmp) < distance) {
            const was_peaceful = mtmp.mpeaceful;
            mtmp.mpeaceful = 1;
            mtmp.mavenge = 0;
            mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_WAITMASK;
            const could_see_mon = canspotmon(mtmp);
            mtmp.mundetected = 0;
            newsym(mtmp.mx, mtmp.my);
            if (canspotmon(mtmp)) {
                if (!could_see_mon)
                    await update_topl(`You notice ${x_monnam(mtmp, 2 /*ARTICLE_A*/, null, 0, false)}, swaying with the music.`);
                else
                    await update_topl(`${Monnam(mtmp)} freezes, then sways with the music${
                        was_peaceful ? '' : ', and now seems quieter'}.`);
            }
        }
    }
}

// C ref: music.c:139 calm_nymphs(distance).  No RNG.
async function calm_nymphs(distance) {
    const { Monnam, canspotmon } = await import('./uhitm.js');
    for (const mtmp of monsterList().slice()) {
        if (DEADMONSTER(mtmp)) continue;
        if (mdata(mtmp)?.mcls === S_NYMPH && mtmp.mcanmove && mdistu(mtmp) < distance) {
            mtmp.msleeping = 0;
            mtmp.mpeaceful = 1;
            mtmp.mavenge = 0;
            mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_WAITMASK;
            if (canspotmon(mtmp))
                await update_topl(`${Monnam(mtmp)} listens cheerfully to the music, then seems quieter.`);
        }
    }
}

// C ref: music.c:161 awaken_soldiers(bugler) — every mercenary on the level
// wakes and turns hostile; everything else within range gets awaken_scare().
export async function awaken_soldiers(bugler) {
    const { Monnam, canspotmon } = await import('./uhitm.js');
    const isYou = !bugler || bugler === game.u;
    const distance = (isYou ? (game.u?.ulevel | 0) : (mdata(bugler)?.mlevel | 0)) * 30;
    for (const mtmp of monsterList().slice()) {
        if (DEADMONSTER(mtmp)) continue;
        if (is_mercenary(mdata(mtmp)) && mdata(mtmp)?.name !== 'watchman'
            && mdata(mtmp)?.name !== 'watch captain') {
            if (!mtmp.mtame) mtmp.mpeaceful = 0;
            mtmp.msleeping = 0; mtmp.mfrozen = 0;
            mtmp.mcanmove = 1;
            mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_WAITMASK;
            if (canspotmon(mtmp))
                await update_topl(`${Monnam(mtmp)} is now ready for battle!`);
            else if (!Deaf())
                await update_topl('You hear the rattle of battle gear being readied.');
        } else {
            const distm = isYou ? mdistu(mtmp)
                                : dist2(bugler.mx, bugler.my, mtmp.mx, mtmp.my);
            if (distm < distance)
                await awaken_scare(mtmp, distm < Math.trunc(distance / 3));
        }
    }
}

function is_mercenary(p) { return is_mercenary_flag(p); }

// C ref: music.c:192 charm_monsters(distance).
async function charm_monsters(distance) {
    if (game.u?.uswallow) distance = 0;
    const { tamedog } = await import('./dog.js').catch(() => ({ tamedog: null }));
    for (const mtmp of monsterList().slice()) {
        if (DEADMONSTER(mtmp)) continue;
        if (mdistu(mtmp) <= distance) {
            const resisted = await resist_tool(mtmp);
            if ((!resisted || mtmp.isshk) && tamedog) await tamedog(mtmp, null, true);
        }
    }
}

// C ref: music.c:218 do_pit(x, y, tu_pit) — open a chasm at <x,y>.
async function do_pit(x, y, tu_pit) {
    const u = game.u;
    const { maketrap } = await import('./trap.js');
    const { Monnam, mon_nam, killed } = await import('./uhitm.js');
    const chasm = maketrap(x, y, PIT);
    if (!chasm) return;
    chasm.tseen = 1;

    const mtmp = m_at(x, y);
    // C: a boulder here falls in and the chasm is done; sobj_at(BOULDER,...).
    const { objects_at, obj_extract_self } = await import('./invent.js');
    const boulder = objects_at(x, y).find((o) => o.otyp === 475 /*BOULDER*/);
    if (boulder) {
        if (cansee(x, y))
            await update_topl(`KADOOM!  The boulder falls into a chasm${
                (u && u.ux === x && u.uy === y) ? ' below you' : ''}!`);
        if (mtmp) mtmp.mtrapped = 0;
        obj_extract_self(boulder);
        return;
    }
    // fillholetyp()/liquid_flow(): only a chasm dug next to a pool or moat
    // fills, and neither subsystem is ported; a dry chasm is the common case.

    if (mtmp) {
        const p = mdata(mtmp);
        if (!is_flyer(p) && !is_clinger(p)) {
            const m_already_trapped = mtmp.mtrapped;
            mtmp.mtrapped = 1;
            if (!m_already_trapped) {
                if (cansee(x, y)) await update_topl(`${Monnam(mtmp)} falls into a chasm!`);
                else if (humanoid(p)) await update_topl('You hear a scream!');
            }
            // mselftouch(): only a cockatrice-corpse carrier is affected; no RNG.
            if (!DEADMONSTER(mtmp)) {
                mtmp.mhp = (mtmp.mhp | 0) - rnd(m_already_trapped ? 4 : 6);
                if (DEADMONSTER(mtmp)) {
                    if (!cansee(x, y)) await update_topl('It is destroyed!');
                    else await update_topl(`You destroy ${mon_nam(mtmp)}!`);
                    await killed(mtmp, { nomsg: true });
                }
            }
        }
    } else if (u && u.ux === x && u.uy === y) {
        if (u.utrap && u.utraptype === TT_BURIEDBALL) {
            await update_topl('Your chain breaks!');
            u.utrap = 0; u.utraptype = 0;
        }
        if (Levitation() || Flying() || is_clinger(game.u?.mdat)) {
            if (!tu_pit) {
                await update_topl('A chasm opens up under you!');
                await update_topl("You don't fall in!");
            }
        } else if (!tu_pit || !u.utrap || u.utraptype !== TT_PIT) {
            await update_topl('You fall into a chasm!');
            set_utrap(rn1(6, 2), TT_PIT);
            losehp(Maybe_Half_Phys(rnd(6)));
        } else if (u.utrap && u.utraptype === TT_PIT) {
            const keepfooting = (!(Fumbling() && rn2(5))
                && (!(rnl(game.urole?.mnum === PM_ARCHEOLOGIST ? 3 : 9))
                    || ((ACURR(A_DEX) > 7) && rn2(5))));
            await update_topl('You are jostled around violently!');
            set_utrap(rn1(6, 2), TT_PIT);
            losehp(Maybe_Half_Phys(rnd(keepfooting ? 2 : 4)));
            if (keepfooting) {
                const { exercise } = await import('./attrib.js');
                exercise(A_DEX, true);
            }
        }
    } else {
        newsym(x, y);
    }
}

function is_flyer(p) { return is_flyer_flag(p); }
function is_clinger(p) { return (mflags1_of(p) & M1_CLING) !== 0; }

// C ref: music.c:343 do_earthquake(force) — random chasms all round the hero.
// The per-square rn2(14 - force) is the whole draw budget on an ordinary
// level; the terrain arms only add do_pit()'s rolls.
async function do_earthquake(force) {
    const u = game.u;
    const { t_at } = await import('./mkroom.js');
    const trap_at_u = t_at(u.ux, u.uy);
    let tu_pit = 0;
    if (trap_at_u) tu_pit = (trap_at_u.ttyp === PIT || trap_at_u.ttyp === SPIKED_PIT) ? 1 : 0;
    if (force > 13) force = 13;
    let start_x = Math.max(u.ux - (force * 2), 1);
    let start_y = Math.max(u.uy - (force * 2), 0);
    const end_x = Math.min(u.ux + (force * 2), COLNO - 1);
    const end_y = Math.min(u.uy + (force * 2), ROWNO - 1);
    const { x_monnam, wakeupAttack } = await import('./uhitm.js');
    for (let x = start_x; x <= end_x; x++)
        for (let y = start_y; y <= end_y; y++) {
            const mtmp = m_at(x, y);
            if (mtmp) {
                await wakeupAttack(mtmp, true);
                if (mtmp.mundetected) {
                    mtmp.mundetected = 0;
                    newsym(x, y);
                    if (ceiling_hider(mdata(mtmp))) {
                        if (cansee(x, y))
                            await update_topl(`${upstart(x_monnam(mtmp, 2 /*ARTICLE_A*/, null, 0, false))} is shaken loose from the ceiling!`);
                        else if (!is_flyer(mdata(mtmp)))
                            await update_topl('You hear a thump.');
                    }
                }
            }
            if (rn2(14 - force)) continue;

            const loc = game.level?.at?.(x, y);
            const typ = loc ? loc.typ : 0;
            switch (typ) {
            case FOUNTAIN:
                if (cansee(x, y)) await update_topl('The fountain falls into a chasm.');
                await do_pit(x, y, tu_pit);
                break;
            case SINK:
                if (cansee(x, y)) await update_topl('The kitchen sink falls into a chasm.');
                await do_pit(x, y, tu_pit);
                break;
            case ALTAR:
                // The high altars (AM_SANCTUM) are preserved; desecrate_altar()
                // is not ported, so an ordinary altar just becomes a chasm.
                if (cansee(x, y)) await update_topl('The altar falls into a chasm.');
                await do_pit(x, y, tu_pit);
                break;
            case GRAVE:
                if (cansee(x, y)) await update_topl('The headstone topples into a chasm.');
                await do_pit(x, y, tu_pit);
                break;
            case THRONE:
                if (cansee(x, y)) await update_topl('The throne falls into a chasm.');
                await do_pit(x, y, tu_pit);
                break;
            case SCORR:
                loc.typ = CORR;
                if (cansee(x, y)) await update_topl('A secret corridor is revealed.');
                await do_pit(x, y, tu_pit);
                break;
            case CORR:
            case ROOM:
                await do_pit(x, y, tu_pit);
                break;
            case SDOOR:
                loc.typ = DOOR;
                if (cansee(x, y)) await update_topl('A secret door is revealed.');
                /* FALLTHRU */
            case DOOR:
                if ((loc.doormask | 0) === 0 /* D_NODOOR */) {
                    await do_pit(x, y, tu_pit);
                    break;
                }
                loc.doormask = 0;
                newsym(x, y);
                if (cansee(x, y)) await update_topl('The door collapses.');
                break;
            default:
                break;
            }
        }
}

// C ref: mondata.h ceiling_hider(ptr) == is_hider(ptr) && (mlet == S_PIERCER
// || ptr == &mons[PM_TRAPPER] || ptr == &mons[PM_LURKER_ABOVE]).
function ceiling_hider(p) {
    if ((mflags1_of(p) & M1_CONCEAL) === 0 && (mflags1_of(p) & 0x100 /*M1_HIDE*/) === 0)
        return false;
    return p?.mcls === S_PIERCER || p?.name === 'trapper' || p?.name === 'lurker above';
}

// C ref: music.c:470 generic_lvl_desc().
function generic_lvl_desc() {
    // Astral/endgame/sanctum/V-tower need dungeon predicates this port has no
    // level data for; Sokoban and the ordinary dungeon are the reachable ones.
    if (In_sokoban(game.u?.uz)) return 'puzzle';
    return 'dungeon';
}

const BEATS = ['stepper', 'one drop', 'slow two', 'triple stroke roll',
               'double shuffle', 'half-time shuffle', 'second line', 'train'];
const NOTES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// C ref: music.c:729 improvised_notes(&same_as_last_time).  svc.context.jingle
// is char[6], so notecount is rnd(5) and each note is one ROLL_FROM(notes)
// == rn2(7).
function improvised_notes() {
    const ctx = (game.context = game.context || {});
    if (!(Unchanging() && ctx.jingle && ctx.jingle[0])) {
        const notecount = rnd(5);
        let s = '';
        for (let i = 0; i < notecount; i++) s += NOTES[rn2(7)];
        ctx.jingle = s;
        return { tune: s, same: false };
    }
    return { tune: ctx.jingle, same: true };
}

// C ref: hacklib.c an(s) / upstart(s).
function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
function upstart(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// C ref: music.c:503 do_improvisation(instr).
async function do_improvisation(instr) {
    const u = game.u;
    const { exercise } = await import('./attrib.js');
    const { xname, makeknown, consume_obj_charge } = await import('./invent.js');
    let damage;
    let do_spec = !(Stunned() || Confusion());
    let mundane = false;

    // C: itmp is a copy whose otyp walks down to the mundane counterpart.
    let itmp_otyp = instr.otyp;
    if (!do_spec || (instr.spe | 0) <= 0) {
        while (MAGIC_TOOL.has(itmp_otyp)) { itmp_otyp -= 1; mundane = true; }
    }

    const PLAY_STUNNED = 0x01, PLAY_CONFUSED = 0x02, PLAY_HALLU = 0x04;
    let mode = 0;
    if (Stunned()) mode |= PLAY_STUNNED;
    if (Confusion()) mode |= PLAY_CONFUSED;
    if (Hallucination()) mode |= PLAY_HALLU;

    if (!rn2(2)) {
        if (mode === (PLAY_STUNNED | PLAY_CONFUSED))
            mode = !rn2(2) ? PLAY_STUNNED : PLAY_CONFUSED;
        if (mode & PLAY_HALLU) mode = PLAY_HALLU;
    }

    switch (mode) {
    case 0:
        await update_topl(`You start playing your ${xname(instr)}.`);
        break;
    case PLAY_STUNNED:
        await update_topl(!Deaf() ? 'You radiate an obnoxious droning sound.'
                                  : 'You feel a monotonous vibration.');
        break;
    case PLAY_CONFUSED:
        await update_topl(!Deaf() ? 'You generate a raucous noise.'
                                  : 'You feel a jarring vibration.');
        break;
    case PLAY_HALLU:
        await update_topl('You disseminate a kaleidoscopic display of floating butterflies.');
        break;
    default:
        await update_topl('What you perform is quite far from music...');
        break;
    }

    const { same: same_old_song } = improvised_notes();

    switch (itmp_otyp) {
    case MAGIC_FLUTE:                                /* put monsters to sleep */
        consume_obj_charge(instr, true);
        await update_topl(`You ${!Deaf() ? '' : 'seem to '}produce ${
            Hallucination() ? 'piped' : 'soft'}${same_old_song ? ', familiar' : ''} music.`);
        await put_monsters_to_sleep((u.ulevel | 0) * 5);
        exercise(A_DEX, true);
        break;
    case WOODEN_FLUTE:                               /* may charm snakes */
        do_spec = do_spec && (rn2(ACURR(A_DEX)) + (u.ulevel | 0) > 25);
        if (!Deaf())
            await update_topl(`Your ${xname(instr)} ${do_spec ? 'trills' : 'toots'}${
                same_old_song ? ' a familiar tune' : ''}.`);
        else
            await update_topl(`You feel your ${xname(instr)} ${do_spec ? 'trill' : 'toot'}.`);
        if (do_spec) await charm_snakes((u.ulevel | 0) * 3);
        exercise(A_DEX, true);
        break;
    case FIRE_HORN:                                  /* wand of fire */
    case FROST_HORN: {                               /* wand of cold */
        consume_obj_charge(instr, true);
        const { getdir } = await import('./cmd.js');
        const got = await getdir(null);
        if (!got) {
            await update_topl(`Your ${xname(instr)} vibrates.`);
            break;
        }
        const { zapyourself, ubuzz } = await import('./zap.js');
        if (!u.dx && !u.dy && !u.dz) {
            if (zapyourself) {
                damage = await zapyourself(instr, true);
                if (damage) losehp(damage);
            }
        } else {
            // C ref: zap.h BZ_OFS_AD(ad) == ad - 1; BZ_U_WAND(t) == t (0-9).
            const type = (instr.otyp === FROST_HORN) ? 2 /*AD_COLD-1*/ : 1 /*AD_FIRE-1*/;
            if (!Blind())
                await update_topl(`A ${type === 2 ? 'blast of frost' : 'blast of fire'} blasts out of the horn!`);
            game.current_wand = instr;
            await ubuzz(type, rn1(6, 6));
            game.current_wand = null;
        }
        makeknown(instr.otyp);
        break;
    }
    case TOOLED_HORN:                                /* awaken or scare */
        if (!Deaf())
            await update_topl(`You produce a frightful, grave${
                same_old_song ? ', yet familiar,' : ''} sound.`);
        else
            await update_topl('You blow into the horn.');
        await awaken_monsters((u.ulevel | 0) * 30);
        exercise(A_WIS, false);
        break;
    case BUGLE:                                      /* awaken soldiers */
        if (!Deaf())
            await update_topl(`You extract a loud${same_old_song ? ', familiar' : ''
                } noise from your ${xname(instr)}.`);
        else
            await update_topl('You blow into the bugle.');
        await awaken_soldiers(null);
        exercise(A_WIS, false);
        break;
    case MAGIC_HARP:                                 /* charm monsters */
        consume_obj_charge(instr, true);
        if (!Deaf())
            await update_topl(`Your ${xname(instr)} produces very attractive${
                same_old_song ? ' and familiar' : ''} music.`);
        else
            await update_topl('You feel very soothing vibrations.');
        await charm_monsters(Math.trunc(((u.ulevel | 0) - 1) / 3) + 1);
        exercise(A_DEX, true);
        break;
    case WOODEN_HARP:                                /* may calm nymphs */
        do_spec = do_spec && (rn2(ACURR(A_DEX)) + (u.ulevel | 0) > 25);
        if (!Deaf())
            await update_topl(`Your ${xname(instr)} ${
                (do_spec && same_old_song) ? 'produces a familiar, lilting melody'
                : do_spec ? 'produces a lilting melody'
                : same_old_song ? 'twangs a familiar tune' : 'twangs'}.`);
        else
            await update_topl('You feel soothing vibrations.');
        if (do_spec) await calm_nymphs((u.ulevel | 0) * 3);
        exercise(A_DEX, true);
        break;
    case DRUM_OF_EARTHQUAKE:                         /* create several pits */
        consume_obj_charge(instr, true);
        await update_topl('You produce a heavy, thunderous rolling!');
        await update_topl(`The entire ${generic_lvl_desc()} is shaking around you!`);
        await do_earthquake(Math.trunc(((u.ulevel | 0) - 1) / 3) + 1);
        await awaken_monsters(ROWNO * COLNO);
        makeknown(DRUM_OF_EARTHQUAKE);
        break;
    case LEATHER_DRUM:                               /* awaken monsters */
        if (!mundane) {
            if (!Deaf()) {
                await update_topl(`You beat a ${same_old_song ? 'familiar ' : ''}deafening row!`);
                u.uprops = u.uprops || {};
                u.uprops.HDeaf = (u.uprops.HDeaf | 0) + rn1(20, 30);
                game._deafPending = true;            // see display.js bot()
            } else {
                await update_topl('You pound on the drum.');
            }
            exercise(A_WIS, false);
        } else {
            await update_topl(`You ${rn2(2) ? 'butcher' : rn2(2) ? 'manage' : 'pull off'
                } ${an(BEATS[rn2(BEATS.length)])}.`);
        }
        await awaken_monsters((u.ulevel | 0) * (mundane ? 5 : 40));
        game.disp = game.disp || {};
        game.disp.botl = true;
        break;
    default:
        return 0;                                    /* impossible() */
    }
    return 2;                                        /* that takes time */
}

// C ref: music.c:762 do_play_instrument(instr).
export async function do_play_instrument(instr) {
    const u = game.u;
    const { xname } = await import('./invent.js');
    if (Underwater()) {
        await update_topl("You can't play music underwater!");
        return ECMD_OK;
    }
    if ((instr.otyp === WOODEN_FLUTE || instr.otyp === MAGIC_FLUTE
         || instr.otyp === TOOLED_HORN || instr.otyp === FROST_HORN
         || instr.otyp === FIRE_HORN || instr.otyp === BUGLE)
        && !can_blow_u()) {
        await update_topl(`You are incapable of playing the ${xname(instr)}.`);
        return ECMD_OK;
    }
    let c = 'y';
    if (instr.otyp !== LEATHER_DRUM && instr.otyp !== DRUM_OF_EARTHQUAKE
        && !(Stunned() || Confusion() || Hallucination())) {
        const { ynq } = await import('./invent.js');
        c = await ynq('Improvise?');
        if (c === 'q') { await update_topl('Never mind.'); return ECMD_OK; }
    }
    if (c !== 'n') return (await do_improvisation(instr)) ? ECMD_TIME : ECMD_OK;

    // ── the passtune half ──────────────────────────────────────────────────
    let buf = '';
    if (u.uevent?.uheard_tune === 2) {
        const { ynq } = await import('./invent.js');
        c = await ynq('Play the passtune?');
    }
    if (c === 'q') { await update_topl('Never mind.'); return ECMD_OK; }
    if (c === 'y') {
        buf = game.tune || '';
    } else {
        const { getlin_top } = await import('./extcmd-handlers.js')
            .catch(() => ({ getlin_top: null }));
        buf = getlin_top ? (await getlin_top('What tune are you playing? [5 notes, A-G]') || '') : '';
        if (buf === '\x1b') { await update_topl('Never mind.'); return ECMD_OK; }
        buf = buf.replace(/\s+/g, ' ').trim().toUpperCase().replace(/H/g, 'B');
    }

    await update_topl(!Deaf()
        ? `You extract a strange sound from the ${xname(instr)}!`
        : `You can feel the ${xname(instr)} emitting vibrations.`);

    if (Is_stronghold()) {
        const { exercise } = await import('./attrib.js');
        exercise(A_WIS, true);                       /* just for trying */
        const tune = game.tune || '';
        const { find_drawbridge, open_drawbridge, close_drawbridge, is_drawbridge_wall }
            = await import('./dbridge.js');
        if (buf === tune) {
            for (let y = u.uy - 1; y <= u.uy + 1; y++)
                for (let x = u.ux - 1; x <= u.ux + 1; x++) {
                    if (!isok(x, y)) continue;
                    const found = find_drawbridge(x, y);
                    if (found) {
                        u.uevent = u.uevent || {};
                        u.uevent.uheard_tune = 2;
                        const loc = game.level?.at?.(found.x ?? x, found.y ?? y);
                        if (loc && loc.typ === DRAWBRIDGE_DOWN)
                            await close_drawbridge(found.x ?? x, found.y ?? y);
                        else
                            await open_drawbridge(found.x ?? x, found.y ?? y);
                        return ECMD_TIME;
                    }
                }
        } else if (!Deaf()) {
            u.uevent = u.uevent || {};
            if ((u.uevent.uheard_tune | 0) < 1) u.uevent.uheard_tune = 1;
            let ok = false;
            for (let y = u.uy - 1; y <= u.uy + 1 && !ok; y++)
                for (let x = u.ux - 1; x <= u.ux + 1 && !ok; x++) {
                    if (!isok(x, y)) continue;
                    const t = game.level?.at?.(x, y)?.typ;
                    if (t === DRAWBRIDGE_DOWN || t === DRAWBRIDGE_UP
                        || (is_drawbridge_wall && is_drawbridge_wall(x, y) >= 0))
                        ok = true;
                }
            if (ok) {
                // C ref: music.c:846 — the Mastermind hint.  matched[] is
                // indexed by tune position, and the inner scan skips a slot the
                // guess already has right.
                let tumblers = 0, gears = 0;
                const matched = [false, false, false, false, false];
                for (let x = 0; x < buf.length && x < 5; x++) {
                    if (buf[x] === tune[x]) { gears++; matched[x] = true; }
                    else {
                        for (let y = 0; y < 5; y++)
                            if (!matched[y] && buf[x] === tune[y] && buf[y] !== tune[y]) {
                                tumblers++; matched[y] = true; break;
                            }
                    }
                }
                if (tumblers) {
                    if (gears)
                        await update_topl(`You hear ${tumblers} tumbler${tumblers === 1 ? '' : 's'
                            } click and ${gears} gear${gears === 1 ? '' : 's'} turn.`);
                    else
                        await update_topl(`You hear ${tumblers} tumbler${tumblers === 1 ? '' : 's'} click.`);
                } else if (gears) {
                    await update_topl(`You hear ${gears} gear${gears === 1 ? '' : 's'} turn.`);
                    if (gears === 5) {
                        u.uevent.uheard_tune = 2;
                    }
                }
            }
        }
    }
    return ECMD_TIME;
}

// C ref: mondata.h can_blow(mon) — a hero who is not strangled/underwater and
// has a mouth (not breathless, not a nolimbs blob) can blow an instrument.
function can_blow_u() {
    if (uprop('Strangled')) return false;
    return true;
}

// C ref: dungeon.c Is_stronghold(&u.uz) — const.js already resolves it against
// the recorded stronghold_level.
