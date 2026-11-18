import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';
import { decodeScreen, diffCell } from '../frozen/screen-decode.mjs';

// C recordings of the options menu with a symset rc (no forced --More-- on a
// toggle), an option handler's menu closing inside the options menu (status
// rows stay blank), pick_lock feeling a lit corridor (a turn is charged), and
// a monster hiding under water on its first postmov (its trailing newsym).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/full-run-regressions.json', import.meta.url), 'utf8'));

for (const c of fixture.cases) {
    test(`matches C: ${c.name}`, async () => {
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
    });
}
