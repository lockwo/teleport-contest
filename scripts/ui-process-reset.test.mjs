import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeScreen } from '../frozen/screen-decode.mjs';
import { runSegment } from '../js/jsmain.js';

// Every case was recorded from fresh C processes (one per segment) by
// swarm/bin/scenario.mjs.  #herecmdmenu queues its canned answer on CQ_CANNED
// (cmd.c act_on_act), never in a keyboard buffer that outlives the command or
// the process.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/herecmdmenu-canned-queue.json', import.meta.url), 'utf8'));
const isRng = (x) => typeof x === 'string' && /^(?:rn2|rnd|rn1|rnl|rne|rnz|d)\(/.test(x);
const normRng = (x) => String(x ?? '').replace(/\s*@\s.*$/, '').replace(/^\d+\s+/, '').trim();

for (const c of fixture.cases) {
    test(`#herecmdmenu canned answer matches C: ${c.name}`, async () => {
        const trace = createHash('sha256');
        let calls = 0;
        for (const [i, segment] of c.segments.entries()) {
            const game = await runSegment(segment);
            for (const entry of game.getRngLog()) {
                if (!isRng(entry)) continue;
                trace.update(`${normRng(entry)}\n`);
                calls++;
            }
            const screens = game.getScreens();
            const rows = decodeScreen(screens[screens.length - 1]).map((r) => r.map((cell) => cell.ch).join('').trimEnd());
            for (const [idx, want] of Object.entries(i === 0 ? c.frames ?? {} : {})) {
                const got = decodeScreen(screens[Number(idx)]).map((r) => r.map((cell) => cell.ch).join('').trimEnd());
                assert.deepEqual(got, want.rows, `frame ${idx}`);
                assert.deepEqual(game.getCursors()[Number(idx)], want.cursor, `frame ${idx} cursor`);
            }
            assert.deepEqual(rows, c.finals[i].rows, `segment ${i} final screen`);
            assert.deepEqual(game.getCursors().at(-1), c.finals[i].cursor, `segment ${i} final cursor`);
        }
        assert.equal(calls, c.rngCalls);
        assert.equal(trace.digest('hex'), c.rngSha256);
    });
}
