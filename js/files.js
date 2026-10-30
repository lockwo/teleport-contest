// files.js — the tribute-file reader from files.c.
// C ref: files.c choose_passage() / read_tribute().  The rest of files.c (save
// files, locks, config-file parsing, ...) has no counterpart here: this port
// has no filesystem, and the dlb data files are embedded as js/*_data.js.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { pline, putmsghistory } from './display.js';

const SECTIONSCOPE = 1;
const TITLESCOPE = 2;
const PASSAGESCOPE = 3;

const MAXPASSAGES = 30; /* SIZE(svc.context.novel.pasg), include/context.h */

function decodeBase64(b64) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// C ref: files.c TRIBUTEFILE ("tribute") through dlb_fopen(): the embedded
// copy of the bytes the C recorder read, split like dlb_fgets() would hand it
// out (one string per '\n'-terminated line, the newline stripped).
let _tributeLines = null;
async function tribute_lines() {
    if (!_tributeLines) {
        const { TRIBUTE_B64 } = await import('./tribute_data.js');
        const text = new TextDecoder('latin1').decode(decodeBase64(TRIBUTE_B64));
        const lines = text.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        _tributeLines = lines;
    }
    return _tributeLines;
}

// C ref: hacklib.c mungspaces() — collapse runs of whitespace to one space and
// trim leading and trailing space.
function mungspaces(s) {
    return s.replace(/[ \t\n\v\f\r]+/g, ' ').replace(/^ /, '').replace(/ $/, '');
}

// C ref: C atoi() — leading integer, 0 when there is none.
function atoi(s) {
    const m = /^\s*([+-]?\d+)/.exec(s);
    return m ? parseInt(m[1], 10) : 0;
}

// C ref: files.c choose_passage() — choose a random passage that hasn't been
// chosen yet; once all have been chosen, reset the tracking to make all
// passages available again.  `oid` is the book's o_id, used to tell whether
// the same book is being re-read.
function choose_passage(passagecnt, oid) {
    let idx, res;

    if (passagecnt < 1)
        return 0;

    game.context = game.context || {};
    const novel = game.context.novel
        || (game.context.novel = { id: 0, count: 0, pasg: new Array(MAXPASSAGES).fill(0) });

    /* if a different book or we've used up all the passages already,
       reset in order to have all 'passagecnt' passages available */
    if (oid !== novel.id || novel.count === 0) {
        let range = passagecnt, limit = MAXPASSAGES;

        novel.id = oid;
        if (range <= limit) {
            /* collect all of the N indices */
            novel.count = passagecnt;
            for (idx = 0; idx < MAXPASSAGES; idx++)
                novel.pasg[idx] = (idx < passagecnt) ? idx + 1 : 0;
        } else {
            /* collect MAXPASSAGES of the N indices */
            novel.count = MAXPASSAGES;
            idx = 0;
            for (let i = 0; i < passagecnt; ++i, --range) {
                if (range > 0 && rn2(range) < limit) {
                    novel.pasg[idx++] = i + 1;
                    --limit;
                }
            }
        }
    }

    idx = rn2(novel.count);
    res = novel.pasg[idx];
    /* move the last slot's passage index into the slot just used
       and reduce the number of passages available */
    novel.pasg[idx] = novel.pasg[--novel.count];
    return res;
}

// C ref: files.c read_tribute() — returns true if the hero was able to read
// something.  With `nowin_buf` (an object whose .value receives the text) the
// first passage line is fetched into it instead of being shown in a window.
export async function read_tribute(tribsection, tribtitle, tribpassage,
                                   nowin_buf, bufsz, oid) {
    const badtranslation = 'an incomprehensible foreign translation';
    let scope = 0;
    let passagecnt = 0, targetpassage = 0;
    let matchedsection = false, matchedtitle = false;
    let tribwin = null; /* WIN_ERR */
    let grasped = false;
    let foundpassage = false;
    let lastline = '';

    if (nowin_buf)
        nowin_buf.value = '';

    /* check for mandatories */
    if (!tribsection || !tribtitle) {
        if (!nowin_buf)
            await pline(`It's ${badtranslation} of "${tribtitle}"!`);
        return grasped;
    }

    const fileLines = await tribute_lines();

    /*
     * Syntax (not case-sensitive):
     *  %section books
     *
     * In the books section:
     *    %title booktitle (n)
     *          where booktitle=book title without quotes
     *          (n)= total number of passages present for this title
     *    %passage k
     *          where k=sequential passage number
     *
     * %e ends the passage/book/section
     *    If in a passage, it marks the end of that passage.
     *    If in a book, it marks the end of that book.
     *    If in a section, it marks the end of that section.
     *
     *  %section death
     */

    scan:
    for (const line of fileLines) {
        switch (line[0]) {
        case '%':
            if (line.slice(1, 9).toLowerCase() === 'section ') {
                const st = line.slice(9); /* 9 from "%section " */

                scope = SECTIONSCOPE;
                matchedsection = st.toLowerCase() === tribsection.toLowerCase();
            } else if (line.slice(1, 7).toLowerCase() === 'title ') {
                let st = line.slice(7); /* 7 from "%title " */
                const p1 = st.indexOf('(');

                if (p1 >= 0) {
                    const rest = st.slice(p1 + 1);
                    st = mungspaces(st.slice(0, p1));
                    const p2 = rest.indexOf(')');
                    if (p2 >= 0) {
                        passagecnt = atoi(rest.slice(0, p2));
                        scope = TITLESCOPE;
                        if (matchedsection
                            && st.toLowerCase() === tribtitle.toLowerCase()) {
                            matchedtitle = true;
                            targetpassage = !tribpassage
                                ? choose_passage(passagecnt, oid)
                                : (tribpassage <= passagecnt) ? tribpassage : 0;
                        } else {
                            matchedtitle = false;
                        }
                    }
                }
            } else if (line.slice(1, 9).toLowerCase() === 'passage ') {
                const passagenum = atoi(mungspaces(line.slice(9))); /* 9 from "%passage " */

                if (passagenum > 0 && passagenum <= passagecnt) {
                    scope = PASSAGESCOPE;
                    if (matchedtitle && passagenum === targetpassage) {
                        foundpassage = true;
                        if (!nowin_buf)
                            tribwin = [];
                    }
                }
            } else if (line.slice(1, 3).toLowerCase() === 'e ') {
                if (foundpassage)
                    break scan;
                if (scope === TITLESCOPE)
                    matchedtitle = false;
                if (scope === SECTIONSCOPE)
                    matchedsection = false;
                if (scope)
                    --scope;
            }
            /* else: tribute file error, bad % command (debugpline only) */
            break;
        case '#':
            /* comment only, next! */
            break;
        default:
            if (foundpassage) {
                if (!nowin_buf) {
                    /* outputting multi-line passage to text window */
                    tribwin.push(line);
                    if (line)
                        lastline = line;
                } else {
                    /* fetching one-line passage into buffer */
                    nowin_buf.value = line.slice(0, bufsz - 1);
                    break scan; /* don't wait for "%e passage" */
                }
            }
        }
    }

    if (nowin_buf) {
        /* one-line buffer */
        grasped = !!nowin_buf.value;
    } else {
        if (tribwin) { /* implies 'foundpassage' */
            /* multi-line window, normal case;
               if lastline is empty, there were no non-empty lines between
               "%passage n" and "%e passage" so we leave 'grasped' False */
            if (lastline) {
                /* display_nhwindow(tribwin, FALSE): an NHW_MENU window filled
                   with putstr() lines, wrapped like tty_putstr() does */
                const { tty_putstr_text } = await import('./pager.js');
                const { tty_text_window } = await import('./invent.js');
                const wrapped = [];
                for (const ln of tribwin) tty_putstr_text(wrapped, ln);
                await tty_text_window(wrapped);
                /* put the final attribution line into message history,
                   analogous to the summary line from long quest messages */
                if (lastline.includes('['))
                    lastline = mungspaces(lastline); /* to remove leading spaces */
                else /* construct one if necessary */
                    lastline = `[${tribtitle}, by Terry Pratchett]`;
                const p = lastline.lastIndexOf(']');
                if (p >= 0)
                    lastline = `${lastline.slice(0, p)}; passage #${targetpassage}]`;
                putmsghistory(lastline, false);
                grasped = true;
            }
        }
        if (!grasped)
            /* multi-line window, nothing can be read */
            await pline(`It seems to be ${badtranslation} of "${tribtitle}"!`);
    }
    return grasped;
}

// C ref: files.c Death_quote() — fetch one of Death's quotes into `buf` (an
// object whose .value receives the text); false when none could be read.
export async function Death_quote(buf, bufsz) {
    const death_oid = 1; /* chance of oid #1 being a novel is negligible */

    return read_tribute('Death', 'Death Quotes', 0, buf, bufsz, death_oid);
}
