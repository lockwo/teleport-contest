import assert from 'node:assert/strict';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';
import { game } from '../js/gstate.js';
import { adjabil, has_innate, has_innate_fromoutside } from '../js/exper.js';
import { youHaveFast } from '../js/allmain.js';
import { FROMEXPER, FROMOUTSIDE, INTRINSIC } from '../js/const.js';

async function start(role) {
    await runSegment({
        seed: 288276,
        datetime: '20000110090000',
        nethackrc: `OPTIONS=name:Hero,role:${role},race:human,gender:female,align:neutral\n`
            + 'OPTIONS=playmode:debug,!autopickup,!tutorial,!legacy,suppress_alert:3.4.3\n',
        moves: '',
    });
}

test('level changes grant and remove stealth only when adjabil runs', async () => {
    await start('Valkyrie');
    game.u.ulevel = 2;
    await adjabil(1, 2);

    game.u.ulevel = 3;
    assert.equal(has_innate('HStealth'), false);
    await adjabil(2, 3);
    assert.equal(has_innate('HStealth'), true);

    // C clears only FROMEXPER on level loss, preserving an outside grant and timer.
    game.u.uprops.HStealth |= FROMOUTSIDE | 7;
    game.u.ulevel = 2;
    assert.equal(has_innate('HStealth'), true);
    await adjabil(3, 2);
    assert.equal(game.u.uprops.HStealth, FROMOUTSIDE | 7);
    assert.equal(has_innate('HStealth'), false);
    assert.equal(has_innate_fromoutside('HStealth'), true);

    game.u.ulevel = 3;
    await adjabil(2, 3);
    assert.equal(game.u.uprops.HStealth, FROMEXPER | FROMOUTSIDE | 7);
});

test('removing innate speed is not undone by an unrelated level gain', async () => {
    await start('Barbarian');
    game.u.ulevel = 7;
    await adjabil(1, 7);
    assert.equal(youHaveFast(), true);

    // sit.c attrcurse() removes INTRINSIC without changing the hero's level.
    game.u.uprops.HFast &= ~INTRINSIC;
    assert.equal(youHaveFast(), false);
    game.u.ulevel = 8;
    await adjabil(7, 8);
    assert.equal(youHaveFast(), false);

    game.u.ulevel = 6;
    await adjabil(8, 6);
    game.u.ulevel = 7;
    await adjabil(6, 7);
    assert.equal(youHaveFast(), true);
});
