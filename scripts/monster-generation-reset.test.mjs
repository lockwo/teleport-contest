import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/class-order-reset.json', import.meta.url), 'utf8'));

test('monster-class selection starts fresh after a game with alignment abuse', async () => {
    const trace = createHash('sha256');
    for (const segment of fixture.segments) {
        const game = await runSegment(segment);
        for (const entry of game.getRngLog()) {
            if (/^(?:rn2|rnd|rn1|rnl|rne|rnz|d)\(/.test(entry)) {
                trace.update(entry.replace(/\s*@\s.*$/, '').replace(/^\d+\s+/, '').trim());
                trace.update('\n');
            }
        }
    }
    // Digest of all 39,432 draws recorded from the two fresh C processes.
    assert.equal(trace.digest('hex'), fixture.rngSha256);
});
