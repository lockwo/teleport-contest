// detect.js — magic detection / search helpers.
// C ref: detect.c.  Ports findit() (secret-door-detection wand / detect-unseen
// spell), which scans the area around the hero for hidden doors, corridors,
// traps and monsters, reveals them, and reports what (if anything) was found.

import { game } from './gstate.js';
import { pline, newsym, terrain_background_glyph, show_glyph_cell } from './display.js';
import { couldsee } from './vision.js';
import { exercise } from './attrib.js';
import { COLNO, ROWNO, BOLT_LIM, SDOOR, SCORR, DOOR, CORR, A_WIS } from './const.js';

// C ref: detect.c findone — reveal a single hidden feature at (zx,zy).
function findone(zx, zy, found) {
    const lev = game.level?.at(zx, zy);
    if (!lev) return;

    if (lev.typ === SDOOR) {
        lev.typ = DOOR;
        newsym(zx, zy);
        found.num_sdoors++;
    } else if (lev.typ === SCORR) {
        lev.typ = CORR;
        newsym(zx, zy);
        found.num_scorrs++;
    }

    const ttmp = (game.level?.traps || []).find(t => t.tx === zx && t.ty === zy);
    if (ttmp && !ttmp.tseen && ttmp.ttyp !== undefined) {
        ttmp.tseen = true;
        newsym(zx, zy);
        found.num_traps++;
    }
    // Hidden / invisible monster detection is not modeled (no such monsters
    // on the covered starting levels), so num_mons stays 0.
}

// C ref: vision.c do_clear_area — apply findone to each cell within range that
// the hero couldsee.  Approximated with a square scan clamped to the bolt
// circle radius; on the covered starts nothing is hidden so exact circle
// geometry is immaterial.
function do_clear_area(scol, srow, range, found) {
    const maxY = Math.min(srow + range, ROWNO - 1);
    const minY = Math.max(srow - range, 0);
    for (let y = minY; y <= maxY; y++) {
        const offset = range;
        const minX = Math.max(scol - offset, 1);
        const maxX = Math.min(scol + offset, COLNO - 1);
        for (let x = minX; x <= maxX; x++)
            if (couldsee(x, y))
                findone(x, y, found);
    }
}

// C ref: detect.c findit — reveal nearby hidden things and report.  Returns
// the count found.
export async function findit() {
    if (game.u?.uswallow) return 0;

    const found = { num_sdoors: 0, num_scorrs: 0, num_traps: 0, num_mons: 0 };
    do_clear_area(game.u.ux, game.u.uy, BOLT_LIM, found);

    const k = (found.num_sdoors ? 1 : 0) + (found.num_scorrs ? 1 : 0)
            + (found.num_traps ? 1 : 0) + (found.num_mons ? 1 : 0);
    let buf = '';
    let num = 0;
    if (found.num_sdoors) {
        buf += found.num_sdoors > 1 ? `${found.num_sdoors} secret doors` : 'a secret door';
        num += found.num_sdoors;
    }
    if (found.num_scorrs) {
        if (buf) buf += (k === 2) ? ' and ' : ', ';
        buf += found.num_scorrs > 1 ? `${found.num_scorrs} secret corridors` : 'a secret corridor';
        num += found.num_scorrs;
    }
    if (found.num_traps) {
        if (buf) buf += (k === 3 && !found.num_mons) ? ', and ' : (k === 2) ? ' and ' : ', ';
        buf += found.num_traps > 1 ? `${found.num_traps} traps` : 'a trap';
        num += found.num_traps;
    }
    if (found.num_mons) {
        if (buf) buf += (k > 2) ? ', and ' : ' and ';
        buf += found.num_mons > 1 ? `${found.num_mons} hidden monsters` : 'a hidden monster';
        num += found.num_mons;
    }
    if (buf)
        await pline(`You reveal ${buf}!`);

    if (!num)
        await pline("You don't find anything.");

    return num;
}

// C ref: detect.c show_map_spot — reveal one cell's terrain into hero memory.
// Secret corridors are exposed (but not secret doors).  Furniture/traps/objects
// layering is simplified to the terrain background, which covers the open-room
// starting levels.  No RNG in the non-confused case.
function show_map_spot(x, y) {
    const lev = game.level?.at(x, y);
    if (!lev) return;
    lev.seenv = 0xff;
    if (lev.typ === SCORR)
        lev.typ = CORR;

    const bg = terrain_background_glyph(lev, x, y);
    // Remember the background so the cell shows even out of sight (matches the
    // dim "magic-mapped" rendering once the hero looks away).
    lev.remembered_glyph = { ch: bg.ch, color: bg.color, decgfx: bg.dec, mapped: true };
    // Redraw via newsym so visible cells stay live and remembered ones appear.
    newsym(x, y);
    if (lev.disp_ch === ' ' || lev.disp_ch == null)
        show_glyph_cell(x, y, bg.ch, bg.color, bg.dec);
}

// C ref: detect.c do_mapping — reveal the whole level into hero memory, then
// exercise Wisdom (rn2(19) via exercise).
export async function do_mapping() {
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            show_map_spot(x, y);
    exercise(A_WIS, true);
}
