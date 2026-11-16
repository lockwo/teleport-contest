import assert from 'node:assert/strict';
import test from 'node:test';
import { runSegment } from '../js/jsmain.js';

test('replayed stash selection retains the corner redraw cursor until input', async () => {
    const game = await runSegment({
        seed: 2138309,
        datetime: '20000110090000',
        nethackrc: 'OPTIONS=name:Quill,role:Rogue,race:human,gender:female,align:chaotic,playmode:debug,suppress_alert:3.4.3,symset:DECgraphics\nOPTIONS=!autopickup\n',
        moves: '  nafi\r\x01s\x1b',
    });
    const cursors = game.getCursors();
    // C docorner(): the last restored glyph ends at column 42 on row 9.
    // Replayed getobj() reads input without drawing a new prompt over it.
    assert.deepEqual(cursors[9], [42, 9, 1]);
    assert.deepEqual(cursors[10], cursors[3], 'cancel returns the cursor to the hero');
});
