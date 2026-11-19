import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';
import { decodeScreen, diffCell } from '../frozen/screen-decode.mjs';

// C ref: hack.c:3093, classify_terrain reads remembered terrain beneath a raised span.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/audit-bridge-parity.json', import.meta.url), 'utf8'));

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
