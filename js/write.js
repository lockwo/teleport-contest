// write.js — port of NetHack 5.0 src/write.c: applying a magic marker.
// Heavy modules (invent/display/objnam/shk/...) are imported lazily inside
// dowrite(), as apply.js does, so apply.js can load this file on demand.

import { game } from './gstate.js';
import { rn2, rn1, rnl } from './rng.js';
import { objects, MAXOCLASSES, mksobj, bcsign, SCROLL_CLASS, SPBOOK_CLASS, SCR_BLANK_PAPER,
         SPE_BLANK_PAPER, SPE_NOVEL, SPE_BOOK_OF_THE_DEAD } from './mkobj.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { A_WIS, MAXULEV, ECMD_OK, ECMD_TIME, ECMD_CANCEL } from './const.js';

// C ref: include/objects.h otyp / monsters.h index (js/mkobj.js numbering,
// which carries SCR_MAIL like the recorder's MAIL_STRUCTURES build).
const SCR_ENCHANT_ARMOR = 323, SCR_DESTROY_ARMOR = 324, SCR_CONFUSE_MONSTER = 325,
      SCR_SCARE_MONSTER = 326, SCR_REMOVE_CURSE = 327, SCR_ENCHANT_WEAPON = 328,
      SCR_CREATE_MONSTER = 329, SCR_TAMING = 330, SCR_GENOCIDE = 331,
      SCR_LIGHT = 332, SCR_TELEPORTATION = 333, SCR_GOLD_DETECTION = 334,
      SCR_FOOD_DETECTION = 335, SCR_IDENTIFY = 336, SCR_MAGIC_MAPPING = 337,
      SCR_AMNESIA = 338, SCR_FIRE = 339, SCR_EARTH = 340, SCR_PUNISHMENT = 341,
      SCR_CHARGING = 342, SCR_STINKING_CLOUD = 343, SCR_MAIL = 364;
const PM_WIZARD = 12;

// C ref: objclass.h OBJ_DESCR(objects[otyp]) — the (shuffled) appearance word.
function OBJ_DESCR(otyp) {
    const ocl = objects[otyp];
    if (!ocl) return null;
    const idx = ocl.oc_descr_idx != null ? ocl.oc_descr_idx : otyp;
    return DESCR_BY_OTYP[idx] ?? null;
}

// C ref: hacklib.c strcmpi() == 0 for two possibly-absent strings.
function same_ci(a, b) {
    return a != null && b != null && a.toLowerCase() === b.toLowerCase();
}

// C ref: hacklib.c mungspaces() — tabs become spaces, runs collapse, and
// leading/trailing space goes.
function mungspaces(s) {
    return s.replace(/[ \t]+/g, ' ').replace(/^ | $/g, '');
}

// C ref: write.c:16 cost(otmp) — base cost of a scroll or a spellbook.
async function cost(otmp) {
    if (otmp.oclass === SPBOOK_CLASS) {
        const { spell_level_of } = await import('./spell.js');
        return 10 * spell_level_of(otmp.otyp);
    }
    switch (otmp.otyp) {
    case SCR_MAIL:
        return 2;
    case SCR_LIGHT:
    case SCR_GOLD_DETECTION:
    case SCR_FOOD_DETECTION:
    case SCR_MAGIC_MAPPING:
    case SCR_AMNESIA:
    case SCR_FIRE:
    case SCR_EARTH:
        return 8;
    case SCR_DESTROY_ARMOR:
    case SCR_CREATE_MONSTER:
    case SCR_PUNISHMENT:
        return 10;
    case SCR_CONFUSE_MONSTER:
        return 12;
    case SCR_IDENTIFY:
        return 14;
    case SCR_ENCHANT_ARMOR:
    case SCR_REMOVE_CURSE:
    case SCR_ENCHANT_WEAPON:
    case SCR_CHARGING:
        return 16;
    case SCR_SCARE_MONSTER:
    case SCR_STINKING_CLOUD:
    case SCR_TAMING:
    case SCR_TELEPORTATION:
        return 20;
    case SCR_GENOCIDE:
        return 30;
    case SCR_BLANK_PAPER:
    default: {
        const { impossible } = await import('./display.js');
        await impossible("You can't write such a weird scroll!");
    }
    }
    return 1000;
}

// C ref: write.c:63 write_ok(obj) — getobj() callback for the object to write on.
function make_write_ok(I) {
    return (obj) => {
        if (!obj || (obj.oclass !== SCROLL_CLASS && obj.oclass !== SPBOOK_CLASS))
            return I.GETOBJ_EXCLUDE;
        if (obj.otyp === SCR_BLANK_PAPER || obj.otyp === SPE_BLANK_PAPER)
            return I.GETOBJ_SUGGEST;
        return I.GETOBJ_DOWNPLAY;
    };
}

// C ref: write.c:78 dowrite(pen) — write -- applying a magic marker.
export async function dowrite(pen) {
    const I = await import('./invent.js');
    const D = await import('./display.js');
    const { Blind } = await import('./vision.js');
    const pline = D.pline;
    const u = game.u;
    let by_descr = false;

    if (I.nohands_youmonst()) {
        await pline('You need hands to be able to write!');
        return ECMD_OK;
    } else if ((u?.uprops?.Glib | 0) > 0) {
        const { fingers_or_gloves } = await import('./do_wear.js');
        await pline(`${I.Tobjnam(pen, 'slip')} from your ${fingers_or_gloves(false)}.`);
        await I.dropx(pen);
        return ECMD_TIME;
    }

    /* get paper to write on */
    const paper = await I.getobj('write on', make_write_ok(I), I.GETOBJ_NOFLAGS);
    if (!paper)
        return ECMD_CANCEL;
    /* can't write on a novel (unless/until it's been converted into a blank
       spellbook), but we want messages saying so to avoid "spellbook" */
    const typeword = (paper.otyp === SPE_NOVEL) ? 'book'
        : (paper.oclass === SPBOOK_CLASS) ? 'spellbook' : 'scroll';
    if (Blind()) {
        if (!paper.dknown) {
            await pline(`You don't know whether that ${typeword} is blank or not.`);
            return ECMD_OK;
        } else if (paper.oclass === SPBOOK_CLASS) {
            /* can't write a magic book while blind */
            const s = I.ysimple_name(pen);
            await pline(`${s.charAt(0).toUpperCase()}${s.slice(1)} can't create braille text.`);
            return ECMD_OK;
        }
    }
    const { observe_object } = await import('./o_init.js');
    observe_object(paper);
    if (paper.otyp !== SCR_BLANK_PAPER && paper.otyp !== SPE_BLANK_PAPER) {
        await pline(`That ${typeword} is not blank!`);
        const { exercise } = await import('./attrib.js');
        exercise(A_WIS, false);
        return ECMD_TIME;
    }
    I.makeknown(SCR_BLANK_PAPER);

    /* what to write */
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    const got = await hooked_tty_getlin(`What type of ${typeword} do you want to write?`, null);
    game._pending_message = '';
    let namebuf = mungspaces(got ?? '\x1b'); /* remove any excess whitespace */
    if (namebuf[0] === '\x1b' || !namebuf)
        return ECMD_TIME;
    let nm = namebuf;
    if (/^scroll /i.test(nm))
        nm = nm.slice(7);
    else if (/^spellbook /i.test(nm))
        nm = nm.slice(10);
    if (/^of /i.test(nm))
        nm = nm.slice(3);

    const bp = nm.search(/ armour/i);
    if (bp >= 0)
        nm = mungspaces(`${nm.slice(0, bp)} armor ${nm.slice(bp + 7)}`);

    let deferred = 0, real = 0;   /* not any scroll or book */
    let deferralchance = 0;       /* incremented for each oc_uname match */
    let first = -1, last = -1;    /* objects[] is grouped by class (skip generic objects) */
    for (let i = MAXOCLASSES; i < objects.length; i++) {
        if (objects[i] && objects[i].oclass === paper.oclass) {
            if (first < 0) first = i;
            last = i;
        }
    }
    let i, found = false;
    /* first loop: look for match with name/description */
    for (i = first; i <= last; i++) {
        /* extra shufflable descr not representing a real object */
        if (!objects[i].name)
            continue;

        if (same_ci(objects[i].name, nm)) {
            if (objects[i].oc_name_known
                /* spellbooks can only be written by_name, so no need to
                   hold out for a 'better' by_descr match */
                || paper.oclass === SPBOOK_CLASS) {
                found = true;
                break;
            } else {
                /* save item in case there are no better by_descr matches */
                real = deferred = i;
                break;
            }
        }

        if (same_ci(OBJ_DESCR(i), nm)) {
            by_descr = true;
            found = true;
            break;
        }
    }
    if (!found) {
        /* second loop: look for match with user-assigned name */
        /* we will get here if 'nm' isn't a real scroll name/descr, or is the
         * name of a real scroll that hasn't been formally IDed. */
        for (i = first; i <= last; i++) {
            /* player might assign same name multiple times and if so,
               we choose one of those matches randomly */
            if (objects[i].oc_uname && same_ci(objects[i].oc_uname, nm)
                /* prefer attempting to write the real scroll type if
                   the typename clobbers a real scroll and is known to
                   be incorrect */
                && !(real && objects[i].oc_name_known)
                && !rn2(++deferralchance)) {
                deferred = i;
                /* writing by user-assigned name is same as by description:
                   fails for books, works for scrolls (having an assigned
                   type name guarantees presence on discoveries list) */
                by_descr = true;
            }
        }

        if (deferred) {
            i = deferred;
        } else {
            await pline(`There is no such ${typeword}!`);
            return ECMD_TIME;
        }
    }

    /* found: */
    if (i === SCR_BLANK_PAPER || i === SPE_BLANK_PAPER) {
        await pline("You can't write that!");
        await pline("It's obscene!");
        return ECMD_TIME;
    } else if (i === SPE_NOVEL) {
        const fanfic = !rn2(3), tearup = !rn2(3);

        if (!fanfic) {
            await pline(`You ${!tearup ? 'prepare' : 'try'} to write the Great Yendorian Novel, but ${
                !D.Hallucination_u() ? 'lack' : 'have too much'} inspiration.`);
        } else {
            await pline(`You ${!tearup ? 'start to ' : ''}produce really ${
                !D.Hallucination_u() ? 'lame' : 'awesome'} fan-fiction.`);
        }
        if (!tearup) {
            await pline('You give up on the idea.');
        } else {
            await pline('You tear it up.');
            I.useup(paper);
        }
        return ECMD_TIME;
    } else if (i === SPE_BOOK_OF_THE_DEAD) {
        await pline('No mere dungeon adventurer could write that.');
        return ECMD_TIME;
    } else if (by_descr && paper.oclass === SPBOOK_CLASS
               && !objects[i].oc_name_known) {
        /* can't write unknown spellbooks by description */
        await pline("Unfortunately you don't have enough information to go on.");
        return ECMD_TIME;
    }

    /* KMH, conduct */
    const uc = u.uconduct || (u.uconduct = {});
    if (!(uc.literate | 0)) {
        const { livelog_printf, LL_CONDUCT } = await import('./livelog.js');
        const { an } = await import('./hacklib.js');
        livelog_printf(LL_CONDUCT, `became literate by writing ${an(typeword)}`);
    }
    uc.literate = (uc.literate | 0) + 1;

    const new_obj = mksobj(i, false, false);
    new_obj.bknown = (paper.bknown && pen.bknown) ? 1 : 0;

    /* shk imposes a flat rate per use, not based on actual charges used */
    const { check_unpaid } = await import('./shk.js');
    await check_unpaid(pen);

    /* see if there's enough ink */
    const basecost = await cost(new_obj);
    if (pen.spe < Math.trunc(basecost / 2)) {
        await pline('Your marker is too dry to write that!');
        I.obfree(new_obj, null);
        return ECMD_TIME;
    }

    /* we're really going to write now, so calculate cost */
    const actualcost = rn1(Math.trunc(basecost / 2), Math.trunc(basecost / 2));
    const curseval = bcsign(pen) + bcsign(paper);
    const { exercise } = await import('./attrib.js');
    exercise(A_WIS, true);
    /* dry out marker */
    if (pen.spe < actualcost) {
        pen.spe = 0;
        await pline('Your marker dries out!');
        /* scrolls disappear, spellbooks don't */
        if (paper.oclass === SPBOOK_CLASS) {
            await pline('The spellbook is left unfinished and your writing fades.');
            I.update_inventory(); /* pen charges */
        } else {
            await pline('The scroll is now useless and disappears!');
            I.useup(paper);
        }
        I.obfree(new_obj, null);
        return ECMD_TIME;
    }
    pen.spe -= actualcost;

    /*
     * Writing by name requires that the hero knows the scroll or
     * book type.  One has previously been read (and its effect
     * was evident) or been ID'd via scroll/spell/throne (or skill
     * for Wizards) and it will be on the discoveries list.
     * Unknown spellbooks can also be written by name if the hero
     * has fresh knowledge of the spell, or if the spell is almost
     * forgotten and the hero is Lucky (with a greater chance than
     * if the spell is unknown or forgotten).
     * (Previous versions allowed scrolls and books to be written
     * by type name if they were on the discoveries list via being
     * given a user-assigned name, even though doing the latter
     * doesn't--and shouldn't--make the actual type become known.)
     *
     * Writing by description requires that the hero knows the
     * description (a scroll's label, that is, since books by_descr
     * are rejected above).  This is done by checking to see if a
     * scroll with the same description has been encountered.
     *
     * Normal requirements can be overridden if hero is Lucky.
     */
    const { known_spell, spe_Unknown, spe_Fresh, spe_GoingStale } = await import('./spell.js');
    const spell_knowledge = (paper.oclass === SPBOOK_CLASS)
        ? known_spell(new_obj.otyp) : spe_Unknown;
    const is_wizard = (game.urole?.mnum ?? u.umonnum) === PM_WIZARD;
    /* if known, then either by-name or by-descr works */
    if (!objects[new_obj.otyp].oc_name_known
        /* else if named, then only by-descr works */
        && !(by_descr && objects[new_obj.otyp].oc_encountered)
        /* else fresh knowledge of the spell works */
        && spell_knowledge !== spe_Fresh
        /* and Luck might override after previous checks have failed */
        && rnl(((is_wizard && paper.oclass !== SPBOOK_CLASS)
                || spell_knowledge === spe_GoingStale) ? 5 : 15)) {
        await pline(`You ${by_descr ? 'fail' : "don't know how"} to write that.`);
        /* scrolls disappear, spellbooks don't */
        if (paper.oclass === SPBOOK_CLASS) {
            await pline('You write in your best handwriting:  "My Diary", but it quickly fades.');
            I.update_inventory(); /* pen charges */
        } else {
            if (by_descr) {
                const { wipeout_text } = await import('./engrave.js');
                namebuf = wipeout_text(OBJ_DESCR(new_obj.otyp) ?? '',
                                       Math.trunc((6 + MAXULEV - u.ulevel) / 6), 0);
            } else {
                namebuf = `${game.plname || u.plname || ''} was here!`;
            }
            await pline(`You write "${namebuf}" and the scroll disappears.`);
            I.useup(paper);
        }
        I.obfree(new_obj, null);
        return ECMD_TIME;
    }
    /* can write scrolls when blind, but requires luck too;
       attempts to write books when blind are caught above */
    if (Blind() && rnl(3)) {
        /* writing while blind usually fails regardless of
           whether the target scroll is known; even if we
           have passed the write-an-unknown scroll test
           above we can still fail this one, so it's doubly
           hard to write an unknown scroll while blind */
        await pline('You fail to write the scroll correctly and it disappears.');
        I.useup(paper);
        I.obfree(new_obj, null);
        return ECMD_TIME;
    }

    /* use up old scroll / spellbook */
    I.useup(paper);

    /* success */
    if (new_obj.oclass === SPBOOK_CLASS) {
        /* acknowledge the change in the object's description... */
        await pline(`The spellbook warps strangely, then turns ${new_book_description(new_obj.otyp)}.`);
    }
    new_obj.blessed = (curseval > 0);
    new_obj.cursed = (curseval < 0);
    if (new_obj.otyp === SCR_MAIL)
        /* 0: delivered in-game via external event (or randomly for fake mail);
           1: from bones or wishing; 2: written with marker */
        new_obj.spe = 2;
    /* unlike alchemy, for example, a successful result yields the
       specifically chosen item so hero recognizes it even if blind;
       the exception is for being lucky writing an undiscovered scroll,
       where the label associated with the type-name isn't known yet;
       but if writing by description, the description is always known */
    new_obj.dknown = 0;
    if (objects[new_obj.otyp].oc_name_known || by_descr)
        observe_object(new_obj);

    const O = await import('./objnam.js');
    const aobjnam = `${(new_obj.quan ?? 1) !== 1 ? `${new_obj.quan} ` : ''}${O.cxname(new_obj)} ${I.otense(new_obj, 'slip')}`;
    await I.hold_another_object(new_obj, 'Oops!  %s out of your grasp!',
                                O.The(aobjnam), null);
    return ECMD_TIME;
}

// C ref: write.c:451 new_book_description(booktype, outbuf) — most book
// descriptions refer to cover appearance, so we can issue a message for
// converting a plain book into one of those with something like "the
// spellbook turns red" or "the spellbook turns ragged"; but some descriptions
// refer to composition and "the book turns vellum" looks funny, so we want to
// insert "into " prior to such descriptions.
function new_book_description(booktype) {
    /* subset of description strings from objects.c */
    const compositions = ['parchment', 'vellum', 'cloth'];
    const descr = OBJ_DESCR(booktype) ?? '';
    return `${compositions.some((c) => same_ci(descr, c)) ? 'into ' : ''}${descr}`;
}
