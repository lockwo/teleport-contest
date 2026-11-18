import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';
import { decodeScreen, diffCell } from '../frozen/screen-decode.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/bones-fobj-order.json', import.meta.url), 'utf8'));

// One storage shared by every segment, as the scorer does, so the first
// segment's bones file is there for the second segment's new game.
function sharedStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        get length() { return m.size; },
        key: (i) => [...m.keys()][i] ?? null,
    };
}

for (const c of fixture.cases) {
    test(`bones level fobj order matches C: ${c.name}`, async () => {
        const storage = sharedStorage();
        for (const segment of c.segments) {
            const replay = await runSegment({ ...segment, storage });
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
