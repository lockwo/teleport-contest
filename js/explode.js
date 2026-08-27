// explode.js — C ref: src/explode.c, ported in full.
//
// explode() is reachable from wands breaking/overcharging (apply.c, read.c),
// a lit potion of oil (potion.c/dothrow.c), scroll of fire (read.c), fireball
// (zap.c), a magic trap dug up (dig.c), muse_unslime (muse.c) and every
// AT_BOOM monster (uhitm.c/mhitu.c/mhitm.c).  The previous port modelled only
// the AD_PHYS gas-spore blast and refused the rest; all eight adtyps are now
// handled, plus scatter(), splatter_burning_oil(), explode_oil() and
// adtyp_to_expltype().

import { game } from './gstate.js';
import { d, rn2, rnd, rn1 } from './rng.js';
import {
    isok, A_STR, ZAP_POS,
    EXPL_NOXIOUS, EXPL_MAGICAL, EXPL_FIERY, EXPL_FROSTY,
    MAY_HITMON, MAY_HITYOU, MAY_DESTROY, MAY_FRACTURE,
    N_DIRS, xdir, ydir,
} from './const.js';
import {
    AD_PHYS, AD_MAGM, AD_FIRE, AD_COLD, AD_DISN, AD_ELEC, AD_DRST,
    AD_ACID, AD_SPC2, AD_SPEL, AD_DREN, AD_ENCH, AD_DRDX, AD_DRCO, AD_DISE,
    AD_PEST,
} from './monattk_data.js';
import { m_at, newsym, update_topl, map_invisible } from './display.js';
import { cansee, couldsee } from './vision.js';
import { is_undead_flag, is_demon_flag } from './monflags_data.js';

// C ref: hack.h:1471 PHYS_EXPL_TYPE; objclass.h:154-156 BURNING_OIL /
// MON_EXPLODE / TRAP_EXPLODE are MAXOCLASSES+1..+3 and MAXOCLASSES is 18
// (RANDOM_CLASS 0 .. VENOM_CLASS 17).
export const PHYS_EXPL_TYPE = -1;
export const BURNING_OIL = 19;
export const MON_EXPLODE = 20;
export const TRAP_EXPLODE = 21;

// C ref: explode.c enum explode_action.
const EXPL_NONE = 0, EXPL_MON = 1, EXPL_HERO = 2, EXPL_SKIP = 4;

// C ref: objects.h otyp (values from js/mkobj.js's OBJECT_DATA, which is the
// port's objects[] table — NOT the raw upstream indices).
const WAND_CLASS = 11, SCROLL_CLASS = 9, GEM_CLASS = 13;
const WAN_MAGIC_MISSILE = 429, WAN_DIGGING = 428, WAN_SLEEP = 432;
const POT_OIL = 321, SCR_FIRE = 339;
const BOULDER = 475, STATUE = 476, ROCK = 474, EGG = 266;
const GLASS = 19;                       // objclass.h oc_material

function DEADMONSTER(m) { return !m || (m.mhp | 0) <= 0; }
function is_you(m) { return !!m && m === game.u; }
// C ref: decl.c gy.youmonst.data — the hero's current form.
function youmonst_data() { return game.u?.mdat || game.u?.data || null; }
function mdata(m) { return m?.data || m?.mdat || null; }

// ── hero property predicates (youprop.h) ───────────────────────────────────
// The port spreads intrinsics over uprops.{X,HX,EX} depending on which file
// wrote them, so test all three spellings rather than picking one and silently
// answering FALSE for a hero who really does resist.
function uprop(...names) {
    const p = game.u?.uprops || {};
    for (const n of names) if ((p[n] | 0) > 0 || p[n] === true) return true;
    return false;
}
function Antimagic() { return uprop('Antimagic', 'HAntimagic', 'EAntimagic') || !!game.u?.Antimagic; }
function Fire_resistance() { return uprop('Fire_resistance', 'HFire_resistance', 'EFire_resistance'); }
function Cold_resistance() { return uprop('Cold_resistance', 'HCold_resistance', 'ECold_resistance'); }
function Shock_resistance() { return uprop('Shock_resistance', 'HShock_resistance', 'EShock_resistance'); }
function Poison_resistance() { return uprop('Poison_resistance', 'HPoison_resistance', 'EPoison_resistance'); }
function Acid_resistance() { return uprop('Acid_resistance', 'HAcid_resistance', 'EAcid_resistance', 'AcidResistance'); }
function Disint_resistance() { return uprop('Disint_resistance', 'HDisint_resistance', 'EDisint_resistance'); }
function Invulnerable() { return uprop('Invulnerable') || !!game.u?.uinvulnerable; }
function Deaf() { return uprop('Deaf', 'HDeaf', 'EDeaf') || !!game.u?.Deaf; }
// C ref: you.h Upolyd == (u.mtimedone != 0).
function Upolyd() { return !!(game.u?.mtimedone) || !!game.u?.Upolyd; }
// C ref: youprop.h Maybe_Half_Phys(dmg).
function Maybe_Half_Phys(dmg) {
    return uprop('Half_physical_damage', 'HHalf_physical_damage') ? Math.trunc((dmg + 1) / 2) : dmg;
}

// C ref: mondata.h resists_*(mon) — the innate MR_* bits.
const MR_FIRE = 0x01, MR_COLD = 0x02, MR_DISINT = 0x08, MR_ELEC = 0x10,
      MR_POISON = 0x20, MR_ACID = 0x40, MR_STONE = 0x80;
function mresists_of(mon) { return mdata(mon)?.mresists || 0; }
function resists_fire(m) { return !!(mresists_of(m) & MR_FIRE); }
function resists_cold(m) { return !!(mresists_of(m) & MR_COLD); }
function resists_elec(m) { return !!(mresists_of(m) & MR_ELEC); }
function resists_acid(m) { return !!(mresists_of(m) & MR_ACID); }
function resists_disint(m) { return !!(mresists_of(m) & MR_DISINT); }
function resists_poison(m) { return !!(mresists_of(m) & MR_POISON); }
// C ref: mondata.h resists_magm(mon) — MR_MAGIC via mon_mr() percentage 100,
// or a MAGIC-resistant species flag.  mons[].mr is the percentage column.
function resists_magm(mon) {
    const p = mdata(mon);
    if (!p) return false;
    if ((p.mr | 0) >= 100) return true;
    return false;
}

// ── flag helpers ───────────────────────────────────────────────────────────
// C ref: mondata.h nonliving(ptr) == is_undead || PM_MANES || weirdnonliving
// (is_golem || mlet == S_VORTEX).  The flag tests come from monflags_data so a
// species added to the table is picked up automatically.
const S_VORTEX = 22, S_GOLEM = 55;      // defsym.h mlet classes
function nonliving(p) {
    return is_undead_flag(p) || p?.name === 'manes'
        || p?.mcls === S_GOLEM || p?.mcls === S_VORTEX;
}
function is_demon(p) { return is_demon_flag(p); }
// C ref: mondata.h completelyburns(ptr) — ONLY the paper and straw golems.
// (completelyrots covers wood/leather, completelyrusts covers iron; neither is
// a fire case, so listing the wood golem here would be wrong.)
function completelyburns(p) {
    return p?.name === 'paper golem' || p?.name === 'straw golem';
}

// C ref: explode.c:26 explosionmask(m, adtyp, olet) — does <x,y> need a shield
// flash, i.e. does the target resist this blast entirely?
export function explosionmask(m, adtyp, olet) {
    let res = EXPL_NONE;
    if (is_you(m)) {
        switch (adtyp) {
        case AD_PHYS: break;
        case AD_MAGM: if (Antimagic()) res = EXPL_HERO; break;
        case AD_FIRE: if (Fire_resistance()) res = EXPL_HERO; break;
        case AD_COLD: if (Cold_resistance()) res = EXPL_HERO; break;
        case AD_DISN:
            // C uses the HERO's permonst for the wand arm (a poly'd hero who is
            // nonliving or a demon is immune to a death field).
            if ((olet === WAND_CLASS)
                ? (nonliving(youmonst_data()) || is_demon(youmonst_data()))
                : Disint_resistance()) res = EXPL_HERO;
            break;
        case AD_ELEC: if (Shock_resistance()) res = EXPL_HERO; break;
        case AD_DRST: if (Poison_resistance()) res = EXPL_HERO; break;
        case AD_ACID: if (Acid_resistance()) res = EXPL_HERO; break;
        default: break;
        }
    } else {
        const p = mdata(m);
        switch (adtyp) {
        case AD_PHYS: break;
        case AD_MAGM: if (resists_magm(m)) res = EXPL_MON; break;
        case AD_FIRE: if (resists_fire(m)) res = EXPL_MON; break;
        case AD_COLD: if (resists_cold(m)) res = EXPL_MON; break;
        case AD_DISN:
            if ((olet === WAND_CLASS) ? (nonliving(p) || is_demon(p))
                                      : resists_disint(m)) res = EXPL_MON;
            break;
        case AD_ELEC: if (resists_elec(m)) res = EXPL_MON; break;
        case AD_DRST: if (resists_poison(m)) res = EXPL_MON; break;
        case AD_ACID: if (resists_acid(m)) res = EXPL_MON; break;
        default: break;
        }
    }
    return res;
}

// C ref: explode.c:118 engulfer_explosion_msg(adtyp, olet).
async function engulfer_explosion_msg(adtyp, olet) {
    const { Monnam } = await import('./uhitm.js');
    const eng = game.u?.ustuck;
    const p = mdata(eng);
    // C ref: mondata.h digests(ptr) — AT_ENGL attack.
    const digest = (p?.mattk || []).some((a) => a && a[0] === 12 /* AT_ENGL */);
    let adj;
    if (digest) {
        switch (adtyp) {
        case AD_FIRE: adj = 'heartburn'; break;
        case AD_COLD: adj = 'chilly'; break;
        case AD_DISN: adj = (olet === WAND_CLASS) ? 'irradiated by pure energy' : 'perforated'; break;
        case AD_ELEC: adj = 'shocked'; break;
        case AD_DRST: adj = 'poisoned'; break;
        case AD_ACID: adj = 'an upset stomach'; break;
        default: adj = 'fried'; break;
        }
        await update_topl(`${Monnam(eng)} gets ${adj}!`);
    } else {
        switch (adtyp) {
        case AD_FIRE: adj = 'toasted'; break;
        case AD_COLD: adj = 'chilly'; break;
        case AD_DISN: adj = (olet === WAND_CLASS) ? 'overwhelmed by pure energy' : 'perforated'; break;
        case AD_ELEC: adj = 'shocked'; break;
        case AD_DRST: adj = 'intoxicated'; break;
        case AD_ACID: adj = 'burned'; break;
        default: adj = 'fried'; break;
        }
        await update_topl(`${Monnam(eng)} gets slightly ${adj}!`);
    }
}

// C ref: mon.c ugolemeffects(damtype, dam) — a poly'd hero who is a flesh or
// iron golem heals instead of taking elec/fire.  No RNG.
function ugolemeffects(damtype, dam) {
    const u = game.u;
    if (!u || !Upolyd()) return;
    const nm = u.umonnum_name || u.mdat?.name || u.data?.name;
    let heal = 0;
    if (damtype === AD_ELEC && nm === 'flesh golem') heal = Math.floor((dam + 5) / 6);
    else if (damtype === AD_FIRE && nm === 'iron golem') heal = dam;
    if (heal) {
        u.mh = Math.min((u.mh | 0) + heal, u.mhmax | 0);
        game.disp = game.disp || {};
        game.disp.botl = true;
    }
}

// C ref: mon.c golemeffects(mon, damtype, dam).  No RNG.
async function golemeffects(mon, damtype, dam) {
    const nm = mdata(mon)?.name;
    let heal = 0;
    if (nm === 'flesh golem') { if (damtype === AD_ELEC) heal = Math.floor((dam + 5) / 6); }
    else if (nm === 'iron golem') { if (damtype === AD_FIRE) heal = dam; }
    else return;
    if (heal) {
        mon.mhp = Math.min((mon.mhp | 0) + heal, mon.mhpmax | 0);
    }
}

// C ref: mondata.c monstseesu()/monstunseesu() — every monster that can see the
// hero remembers whether the hero resisted.  RNG-free, but muse's m_seenres()
// gates read the bit and so it steers a later wand choice.
async function monstseesu_ad(adtyp, clear) {
    const { cvt_adtyp_to_mseenres } = await import('./mhitu.js');
    const bit = cvt_adtyp_to_mseenres(adtyp);
    if (!bit || game.u?.uswallow) return;
    for (const mon of (game.level?.monsters || [])) {
        if (DEADMONSTER(mon)) continue;
        if (!couldsee(mon.mx, mon.my)) continue;
        mon.seen_resistance = clear ? ((mon.seen_resistance | 0) & ~bit)
                                    : ((mon.seen_resistance | 0) | bit);
    }
}

function engulfing_u(mtmp) {
    return !!(game.u?.uswallow && game.u?.ustuck === mtmp);
}
function next2u(x, y) {
    const u = game.u;
    return !!u && Math.abs(x - u.ux) <= 1 && Math.abs(y - u.uy) <= 1;
}
function dist2(x0, y0, x1, y1) { return (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0); }

// C ref: explode.c:199 explode(x, y, type, dam, olet, expltype).
//
// `expltype` is a glyph-colour selector; the blast animation (tmp_at DISP_BEAM
// ... DISP_END) is fully undone before the first pline, so it never reaches a
// captured frame and only the message/RNG side is modelled.  A NEGATIVE
// expltype still matters: it names the monster the hero gets kill credit for
// (muse_unslime).
export async function explode(x, y, type, dam, olet, expltype) {
    const u = game.u;
    let damu = dam;
    let str = null, adtyp;
    let mdef = null;
    let visible = false, didmsg = false, generic = false, uhurt = 0;
    let exploding_wand_typ = 0;
    const you_exploding = (olet === MON_EXPLODE && type >= 0);
    const explmask = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

    if (olet === WAND_CLASS) {           /* retributive strike */
        if (type < 0) {
            type = -type;
            exploding_wand_typ = type;
            const { objects } = await import('./mkobj.js');
            // C: objects[type].oc_dir == RAY (objclass.h: NODIR 1, IMMEDIATE 2,
            // RAY 3); the port's objects[] names that column `dir`.
            if ((objects?.[type]?.dir | 0) === 3
                && type !== WAN_DIGGING && type !== WAN_SLEEP) {
                type -= WAN_MAGIC_MISSILE;
                if (type < 0 || type > 9) type = 0;
            } else {
                type = 0;
            }
        }
        // C ref: explode.c:241 — the wand's owner takes reduced damage by role.
        // roles[].mnum, the number Role_if() compares against (dokick.js:86):
        // Archeologist 0 .. Healer 3, Knight 4, Monk 5, Cleric 6 .. Wizard 12.
        const rolenum = game.urole?.mnum ?? -1;
        if (rolenum === 6 || rolenum === 5 || rolenum === 12) damu = Math.trunc(damu / 5);
        else if (rolenum === 3 || rolenum === 4) damu = Math.trunc(damu / 2);
    } else if (olet === BURNING_OIL) {
        exploding_wand_typ = POT_OIL;
    } else if (olet === SCROLL_CLASS) {
        exploding_wand_typ = SCR_FIRE;
    } else if (olet === TRAP_EXPLODE) {
        type = 0;
    }
    if (expltype < 0) {
        mdef = m_at(x, y);
        expltype = -expltype;
    }
    const inside_engulfer = !!(u?.uswallow && type >= 0);
    let grabbed = false, grabbing = false;
    const grabxy = { x: 0, y: 0 };
    if (u?.ustuck && !u.uswallow) {
        if (Upolyd()) grabbing = true; else grabbed = true;
        grabxy.x = u.ustuck.mx; grabxy.y = u.ustuck.my;
    }

    if (olet === MON_EXPLODE && !you_exploding) {
        str = game.killer?.name || null;
    }
    if (type === PHYS_EXPL_TYPE) {
        adtyp = AD_PHYS;
    } else {
        let adstr = null;
        switch (Math.abs(type) % 10) {
        case 0: adstr = 'magical blast'; adtyp = AD_MAGM; break;
        case 1:
            adstr = (olet === BURNING_OIL) ? 'burning oil'
                  : (olet === SCROLL_CLASS) ? 'tower of flame' : 'fireball';
            adtyp = AD_FIRE; break;
        case 2: adstr = 'ball of cold'; adtyp = AD_COLD; break;
        case 4:
            adstr = (olet === WAND_CLASS) ? 'death field' : 'disintegration field';
            adtyp = AD_DISN; break;
        case 5: adstr = 'ball of lightning'; adtyp = AD_ELEC; break;
        case 6: adstr = 'poison gas cloud'; adtyp = AD_DRST; break;
        case 7: adstr = 'splash of acid'; adtyp = AD_ACID; break;
        default: return;                 /* impossible("explosion base type") */
        }
        if (!str) str = adstr;
    }

    const { canspotmon } = await import('./uhitm.js');
    for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
            const xx = x + i - 1, yy = y + j - 1;
            if (!isok(xx, yy)) { explmask[i][j] = EXPL_SKIP; continue; }
            explmask[i][j] = EXPL_NONE;
            if (u && xx === u.ux && yy === u.uy)
                explmask[i][j] = explosionmask(u, adtyp, olet);
            let mtmp = m_at(xx, yy);
            if (!mtmp && u && xx === u.ux && yy === u.uy) mtmp = u.usteed;
            if (mtmp && DEADMONSTER(mtmp)) mtmp = null;
            if (mtmp) explmask[i][j] |= explosionmask(mtmp, adtyp, olet);
            if (mtmp && cansee(xx, yy) && !canspotmon(mtmp)) map_invisible(xx, yy);
            else if (!mtmp) unmap_invisible_at(xx, yy);
            if (cansee(xx, yy)) visible = true;
        }

    if (!visible) {
        if (olet === MON_EXPLODE || olet === TRAP_EXPLODE) {
            str = 'explosion';
            generic = true;
        }
        if (!Deaf() && olet !== SCROLL_CLASS) {
            await update_topl('You hear a blast.');
            didmsg = true;
        }
    }
    if (!Deaf() && !didmsg) await update_topl('Boom!');

    // C: "apply effects to monsters and floor objects first, in case the damage
    // to the hero is fatal and leaves bones".  Column-major, exactly as C loops.
    const { destroy_items, resist, zap_over_floor, burnarmor, ignite_items }
        = await import('./zap.js');
    const { Monnam, killed, setmangry } = await import('./uhitm.js');
    if (dam) {
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++) {
                let itemdmg = 0;
                if (explmask[i][j] === EXPL_SKIP) continue;
                const xx = x + i - 1, yy = y + j - 1;
                if (u && xx === u.ux && yy === u.uy) {
                    uhurt = ((explmask[i][j] & EXPL_HERO) !== 0) ? 1 : 2;
                    if (!game.context?.mon_moving && you_exploding) uhurt = 0;
                } else if (inside_engulfer) {
                    continue;
                }
                if (!(u?.uswallow && !game.context?.mon_moving))
                    await zap_over_floor(xx, yy, type, exploding_wand_typ);

                let mtmp = m_at(xx, yy);
                if (!mtmp && u && xx === u.ux && yy === u.uy) mtmp = u.usteed;
                if (!mtmp) continue;
                if (engulfing_u(mtmp)) {
                    await engulfer_explosion_msg(adtyp, olet);
                } else if (cansee(xx, yy)) {
                    await update_topl(`${Monnam(mtmp)} is caught in the ${str}!`);
                }

                itemdmg = await destroy_items(mtmp, adtyp, dam);
                if (adtyp === AD_FIRE) {
                    await burnarmor(mtmp);
                    await ignite_items(mtmp.minvent || []);
                }

                if ((explmask[i][j] & EXPL_MON) !== 0) {
                    await golemeffects(mtmp, adtyp, dam);
                    mtmp.mhp = (mtmp.mhp | 0) - itemdmg;
                } else {
                    let mdam = dam;
                    if (resist(mtmp, olet, 0, false)) {
                        if (cansee(xx, yy) || inside_engulfer)
                            await update_topl(`${Monnam(mtmp)} resists the ${str}!`);
                        mdam = Math.floor((dam + 1) / 2);
                    }
                    if (grabbed && mtmp === u?.ustuck && next2u(x, y)) mdam *= 2;
                    if (resists_cold(mtmp) && adtyp === AD_FIRE) mdam *= 2;
                    else if (resists_fire(mtmp) && adtyp === AD_COLD) mdam *= 2;
                    mtmp.mhp = (mtmp.mhp | 0) - (mdam + itemdmg);
                }
                if (DEADMONSTER(mtmp)) {
                    const xkflg = (adtyp === AD_FIRE && completelyburns(mdata(mtmp)));
                    if (!game.context?.mon_moving) {
                        await killed(mtmp, { nocorpse: xkflg });
                    } else if (mdef && mtmp === mdef) {
                        if (cansee(mtmp.mx, mtmp.my) || canspotmon(mtmp))
                            await update_topl(`${Monnam(mtmp)} is ${
                                xkflg ? 'burned completely'
                                      : nonliving(mdata(mtmp)) ? 'destroyed' : 'killed'}!`);
                        await killed(mtmp, { nomsg: true, nocorpse: xkflg });
                    } else {
                        const { mon_kill_leaving } = await import('./monmove.js');
                        mon_kill_leaving(mtmp, xkflg);
                    }
                } else if (!game.context?.mon_moving) {
                    await setmangry(mtmp, true);
                }
            }
    }

    /* Do your injury last */
    if (uhurt) {
        if (game.flags?.verbose !== false && (type < 0 || olet !== SCROLL_CLASS))
            await update_topl(`You are caught in the ${str}!`);
        if (Invulnerable()) {
            damu = 0;
            await update_topl('You are unharmed!');
        } else if (adtyp === AD_PHYS || adtyp === AD_ACID) {
            damu = Maybe_Half_Phys(damu);
        }
        if (adtyp === AD_FIRE) {
            await burnarmor(u);
            await ignite_items(game.invent || []);
        }
        await destroy_items(u, adtyp, dam);

        ugolemeffects(adtyp, damu);
        if (uhurt === 2) {
            if (grabbing && dist2(grabxy.x, grabxy.y, x, y) <= 2) damu *= 2;
            if (Upolyd()) u.mh = (u.mh | 0) - damu;
            else u.uhp = (u.uhp | 0) - damu;
            game.disp = game.disp || {};
            game.disp.botl = true;
        }
        await monstseesu_ad(adtyp, uhurt !== 1);

        if ((u.uhp | 0) <= 0 || (Upolyd() && (u.mh | 0) <= 0)) {
            if (!Upolyd()) {
                u.uhp = 0;
                // C ref: explode.c:640-668 — the killer string depends on who
                // set off the blast.  KILLED_BY_AN is 0 (hack.h:602); the old
                // port wrote 2 (NO_KILLER_PREFIX) here and dropped "Killed by".
                if (olet === MON_EXPLODE) {
                    if (!generic && str !== game.killer?.name)
                        game.killer = { name: str, format: 0 /* KILLED_BY_AN */ };
                    else
                        game.killer = { name: game.killer?.name || str, format: 0 };
                } else if (olet === TRAP_EXPLODE) {
                    game.killer = { name: `caught ${uhim()}self in a ${str}`, format: 2 };
                } else if (type >= 0 && olet !== SCROLL_CLASS) {
                    game.killer = { name: `caught ${uhim()}self in ${uhis()} own ${str}`, format: 2 };
                } else {
                    const an = (/^tower of flame$/i.test(str) || /^fireball$/i.test(str));
                    game.killer = { name: str, format: an ? 0 : 1 };
                }
                await update_topl(`The ${str} is fatal.`);
            }
        }
        const { exercise } = await import('./attrib.js');
        exercise(A_STR, false);
    }

    // C ref: explode.c:687-694 "explosions are noisy" — wake_nearto(x, y,
    // max(dam*dam, 50)).  RNG-free, but it wakes sleeping monsters and a woken
    // monster picks different m_move moduli from here on.
    {
        const { wake_nearto } = await import('./cmd.js');
        let noise = dam * dam;
        if (noise < 50) noise = 50;
        if (inside_engulfer) noise = Math.floor((noise + 3) / 4);
        await wake_nearto(x, y, noise);
    }
    newsym(x, y);
}

// C ref: hack.c uhim()/uhis().
function uhim() { return (game.u?.mfemale || game.u?.ufemale) ? 'her' : 'him'; }
function uhis() { return (game.u?.mfemale || game.u?.ufemale) ? 'her' : 'his'; }

// C ref: display.c unmap_invisible(x, y) — clear a remembered 'I' when the
// square is known to hold no monster.
function unmap_invisible_at(x, y) {
    const loc = game.level?.at?.(x, y);
    if (loc && loc.glyph_is_invisible) {
        loc.glyph_is_invisible = false;
        newsym(x, y);
    }
}

// ── scatter (explode.c:721) ────────────────────────────────────────────────
// Called when a drawbridge collapses (dbridge.c), a bag of holding blows up
// (pickup.c), a boulder is kicked apart or a tree is kicked (dokick.c) and by
// two trap arms (trap.c).  RNG per object: rnd(quan-1) for a stack split,
// rn2(10) for fracture, rn2(10) for destruction, rn2(N_DIRS) for the direction
// and rnd(force) for the range.
export async function scatter(sx, sy, blastforce, scflags, obj) {
    const { objects_at, splitobj, obj_extract_self, stackobj } = await import('./invent.js');
    const { place_object, objects, weight, next_ident } = await import('./mkobj.js');
    const { breaks } = await import('./dothrow.js');
    const individual_object = !!obj;
    const schain = [];
    let farthest = 0, total = 0;

    for (;;) {
        let otmp = individual_object ? obj : (objects_at(sx, sy)[0] || null);
        if (!otmp) break;
        // C ref: explode.c:743 — the uball/uchain arm calls unpunish(), which
        // this port has no equivalent for; without it the `continue` would spin
        // forever on the chain, so a punished hero's ball/chain is scattered
        // like any other object here.
        if ((otmp.quan | 0) > 1) {
            const qtmp = rnd((otmp.quan | 0) - 1);
            // C ref: mkobj.c splitobj() -> nextoid() -> next_ident(): every
            // stack split spends one rnd(2) on the fragment's o_id.  This
            // port's splitobj() draws nothing, so each call site pays it (as
            // js/invent.js:5856, js/monmove.js:6399, js/eat.js:439 do).
            next_ident();
            otmp = splitobj(otmp, qtmp);
        } else {
            obj = null;                              /* all used */
        }
        obj_extract_self(otmp);
        let used_up = false;

        /* 9 in 10 chance of fracturing boulders or statues */
        if ((scflags & MAY_FRACTURE) !== 0
            && (otmp.otyp === BOULDER || otmp.otyp === STATUE) && rn2(10)) {
            if (otmp.otyp === BOULDER) {
                if (cansee(sx, sy)) await update_topl('The boulder breaks apart.');
                else await update_topl('You hear stone breaking.');
                fracture_rock(otmp, weight);
                place_object(otmp, sx, sy);
            } else {
                if (cansee(sx, sy)) await update_topl('The statue crumbles.');
                else await update_topl('You hear stone crumbling.');
                await break_statue(otmp, weight);
                place_object(otmp, sx, sy);
            }
            newsym(sx, sy);
            used_up = true;
        } else if ((scflags & MAY_DESTROY) !== 0
                   && (!rn2(10) || (objects?.[otmp.otyp]?.material === GLASS
                                    || otmp.otyp === EGG))) {
            if (await breaks(otmp, sx, sy)) used_up = true;
        }

        if (!used_up) {
            const tmpdir = rn2(N_DIRS);
            let tmp = blastforce - Math.floor((otmp.owt | 0) / 40);
            if (tmp < 1) tmp = 1;
            const stmp = {
                obj: otmp, ox: sx, oy: sy,
                dx: xdir[tmpdir], dy: ydir[tmpdir],
                range: rnd(tmp), stopped: false,
            };
            if (farthest < stmp.range) farthest = stmp.range;
            schain.push(stmp);
        }
        if (individual_object && !obj) break;
    }

    const { ohitmon, thitu } = await import('./monmove.js');
    const { dmgval } = await import('./uhitm.js');
    while (farthest-- > 0) {
        for (const stmp of schain) {
            if (!(stmp.range-- > 0) || stmp.stopped) continue;
            let bx = stmp.ox + stmp.dx, by = stmp.oy + stmp.dy;
            const loc = isok(bx, by) ? game.level?.at?.(bx, by) : null;
            const typ = loc ? loc.typ : 0 /* STONE */;
            if (!isok(bx, by)) {
                bx -= stmp.dx; by -= stmp.dy; stmp.stopped = true;
            } else if (!ZAP_POS(typ) || closed_door_at(bx, by)) {
                bx -= stmp.dx; by -= stmp.dy; stmp.stopped = true;
            } else {
                const mtmp = m_at(bx, by);
                if (mtmp) {
                    if (scflags & MAY_HITMON) {
                        stmp.range--;
                        if (await ohitmon(mtmp, stmp.obj, 1, false, bx, by, null)) {
                            stmp.obj = null; stmp.stopped = true;
                        }
                    }
                } else if (game.u && bx === game.u.ux && by === game.u.uy) {
                    if (scflags & MAY_HITYOU) {
                        const { nomul, stop_occupation } = await import('./hack.js');
                        if (game.multi) nomul(0);
                        const dam = dmgval(stmp.obj, game.u);
                        let hitvalu = 8 + (stmp.obj?.spe | 0);
                        const hitu = await thitu(hitvalu, Maybe_Half_Phys(dam), stmp.obj);
                        if (hitu) { stmp.range -= 3; await stop_occupation(); }
                    }
                }
            }
            stmp.ox = bx; stmp.oy = by;
        }
    }
    for (const stmp of schain) {
        const x = stmp.ox, y = stmp.oy;
        if (stmp.obj) {
            if (x !== sx || y !== sy) total += (stmp.obj.quan | 0);
            place_object(stmp.obj, x, y);
            stackobj(stmp.obj);
        }
        newsym(x, y);
    }
    newsym(sx, sy);
    const mtmp = m_at(sx, sy);
    if (mtmp && mtmp.mtrapped) mtmp.mtrapped = 0;
    return total;
}

function closed_door_at(x, y) {
    const loc = game.level?.at?.(x, y);
    return loc?.typ === 23 /* DOOR */ && ((loc.doormask | 0) & (0x04 | 0x08)) !== 0;
}

// C ref: zap.c:5537 fracture_rock(obj) — a boulder/statue becomes a pile of
// rocks.  rn1(60, 7) is the one draw.
function fracture_rock(obj, weight) {
    obj.otyp = ROCK;
    obj.oclass = GEM_CLASS;
    obj.quan = rn1(60, 7);
    obj.owt = weight ? weight(obj) : obj.owt;
    obj.dknown = 0; obj.bknown = 0; obj.rknown = 0;
    obj.known = 1;
    obj.oextra = null;
    return obj;
}

// C ref: zap.c:5582 break_statue(obj) — spill the statue's contents, then
// fracture it.  The STATUE_TRAP arm needs activate_statue_trap().
async function break_statue(obj, weight) {
    const { place_object } = await import('./mkobj.js');
    const { obj_extract_self } = await import('./invent.js');
    while (obj.cobj && obj.cobj.length) {
        const item = obj.cobj[0];
        obj_extract_self(item);
        place_object(item, obj.ox, obj.oy);
    }
    obj.spe = 0;
    fracture_rock(obj, weight);
    return true;
}

// C ref: explode.c:962 splatter_burning_oil(x, y, diluted_oil).
// ZT_SPELL(ZT_FIRE) = 11.
export async function splatter_burning_oil(x, y, diluted_oil) {
    const dmg = d(diluted_oil ? 3 : 4, 4);
    await explode(x, y, 11, dmg, BURNING_OIL, EXPL_FIERY);
}

// C ref: explode.c:974 explode_oil(obj, x, y).
export async function explode_oil(obj, x, y) {
    const diluted_oil = !!obj?.odiluted;
    if (!obj?.lamplit) return;
    // end_burn(obj, TRUE) — extinguish before the blast can kill the hero.
    obj.lamplit = 0;
    obj.how_lost = 3 /* LOST_EXPLODING */;
    await splatter_burning_oil(x, y, diluted_oil);
}

// C ref: explode.c:987 adtyp_to_expltype(adtyp).
export function adtyp_to_expltype(adtyp) {
    switch (adtyp) {
    case AD_ELEC: case AD_SPEL: case AD_DREN: case AD_ENCH:
        return EXPL_MAGICAL;
    case AD_FIRE: return EXPL_FIERY;
    case AD_COLD: return EXPL_FROSTY;
    case AD_DRST: case AD_DRDX: case AD_DRCO: case AD_DISE:
    case AD_PEST: case AD_PHYS:
        return EXPL_NOXIOUS;
    default: return EXPL_FIERY;
    }
}

// C ref: explode.c:1019 mon_explodes(mon, mattk) — roll the blast damage, kill
// the exploder if it is not already dead, name the killer and detonate.
// mattk is a [aatyp, adtyp, damn, damd] row from js/monattk_data.js.
export async function mon_explodes(mon, mattk) {
    const adtyp = mattk?.[1] | 0;
    const damn = mattk?.[2] | 0, damd = mattk?.[3] | 0;
    let dmg;
    if (damn) dmg = d(damn, damd);
    else if (damd) dmg = d((mdata(mon)?.mlevel | 0) + 1, damd);
    else dmg = 0;

    let type;
    if (adtyp === AD_PHYS) type = PHYS_EXPL_TYPE;
    else if (adtyp >= AD_MAGM && adtyp <= AD_SPC2) type = -((adtyp - 1) + 20);
    else return;                            /* impossible("unknown type") */

    // C: "Kill it now so it won't appear to be caught in its own explosion."
    // The AT_BOOM-on-death caller (xkilled -> corpse_chance) arrives with the
    // exploder already dead and detached, so this is a no-op there; explmu()
    // and explmm() arrive with it alive.
    if (!DEADMONSTER(mon)) {
        const { mon_kill_leaving } = await import('./monmove.js');
        mon_kill_leaving(mon, true);
    }

    const { mon_pmname } = await import('./uhitm.js');
    const nm = mon_pmname(mon) || 'monster';
    const killname = `${/s$/.test(nm) ? `${nm}'` : `${nm}'s`} explosion`;
    const savedKiller = game.killer;
    game.killer = { name: killname, format: 0 /* KILLED_BY_AN */ };

    await explode(mon.mx, mon.my, type, dmg, MON_EXPLODE, adtyp_to_expltype(adtyp));

    // C: reset killer (svk.killer.name[0] = '\0') unless the blast was fatal.
    if ((game.u?.uhp | 0) > 0) game.killer = savedKiller;
}
