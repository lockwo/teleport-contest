import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';
import { game as state } from '../js/gstate.js';
import { GameDisplay } from '../js/game_display.js';
import { decodeScreen, diffCell } from '../frozen/screen-decode.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/parameterized-bindings.json', import.meta.url), 'utf8'));

for (const c of fixture.cases) {
    test(`key binding matches C: ${c.name}`, async () => {
        for (const segment of c.segments) {
            const replay = await runSegment(segment);
            for (const [index, want] of Object.entries(segment.frames)) {
                const got = decodeScreen(replay.getScreens()[Number(index)]);
                const expected = decodeScreen(want.screen);
                for (let y = 0; y < 24; y++) {
                    for (let x = 0; x < 80; x++) {
                        assert.equal(diffCell(expected[y][x], got[y][x]), null,
                            `frame ${index}, cell ${x},${y}`);
                    }
                }
                assert.deepEqual(replay.getCursors()[Number(index)], want.cursor,
                    `frame ${index} cursor`);
            }
        }
        if ('pickup' in c) assert.equal(state.flags.pickup, c.pickup);
        if ('time' in c) assert.equal(state.flags.time, c.time);
    });
}

test('tty string capture skips control and signed bytes without shifting columns', () => {
    const display = new GameDisplay(null);
    display.putstr(0, 0, '1234');
    display.putstr(0, 0, 'a\x1b\x80b');
    assert.equal(display.grid[0].slice(0, 4).map(cell => cell.ch).join(''), 'a23b');
});
