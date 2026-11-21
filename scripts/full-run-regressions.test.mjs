import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';
import { decodeScreen, diffCell } from '../frozen/screen-decode.mjs';

const cases = ['full-run-regressions', 'tty-publication', 'notice-glyph', 'air-status-row'].flatMap(name =>
    JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')).cases);

for (const c of cases) {
    test(`matches C: ${c.name}`, async () => {
        // One Web-Storage-shaped store per session, as the judge shares it
        // across segments (save files, bones, the record file).
        const data = new Map();
        const storage = {
            getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)),
            removeItem: (k) => data.delete(k), get length() { return data.size; },
            key: (i) => [...data.keys()][i] ?? null,
        };
        for (const segment of c.segments) {
            const replay = await runSegment({ ...segment, storage });
            // The judge drops empty C screens (a process that exited leaves a
            // blank final capture), so a segment's screen count must match.
            if (segment.screens != null)
                assert.equal(replay.getScreens().length, segment.screens, 'screen count');
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
