import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/table-process-reset.json', import.meta.url), 'utf8'));

// One shared save store per case, as a session's segments share a save
// directory.  Each segment is a fresh C process, so mons[] starts pristine and
// restore.c restgamestate() -> role_init() is what rewrites the quest
// leader/guardian/nemesis entries for the restored hero's role.
function sharedStorage() {
    const data = new Map();
    return {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
        get length() { return data.size; },
        key: (i) => [...data.keys()][i] ?? null,
    };
}

for (const c of fixture.cases) {
    test(`restored game re-applies its role's quest monster fixups: ${c.name}`, async () => {
        const storage = sharedStorage();
        const trace = createHash('sha256');
        let draws = 0;
        for (const segment of c.segments) {
            const game = await runSegment({ ...segment, storage });
            for (const entry of game.getRngLog()) {
                if (/^(?:rn2|rnd|rn1|rnl|rne|rnz|d)\(/.test(entry)) {
                    trace.update(entry.replace(/\s*@\s.*$/, '').replace(/^\d+\s+/, '').trim());
                    trace.update('\n');
                    draws++;
                }
            }
        }
        // Digest of every draw recorded from the fresh C processes.
        assert.equal(draws, c.draws);
        assert.equal(trace.digest('hex'), c.rngSha256);
    });
}
