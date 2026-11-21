import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';
import { decodeScreen, diffCell } from '../frozen/screen-decode.mjs';

// macOS recorder: keys arrive as single bytes, rc text and argv are UTF-8 bytes,
// the capture drops signed high bytes, and APFS save names are case- and
// normalization-insensitive and must be valid UTF-8.
const { cases } = JSON.parse(readFileSync(new URL('./fixtures/native-bytes.json', import.meta.url), 'utf8'));

for (const c of cases) {
    test(`matches C: ${c.name}`, async () => {
        const data = new Map();
        const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)),
            removeItem: (k) => data.delete(k), get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null };
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
