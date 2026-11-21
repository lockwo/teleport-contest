import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import '../js/jsmain.js';
import { ere_compile } from '../js/pickup.js';
import { parseNethackrc } from '../js/options.js';
import { add_sound_mapping, release_sound_mappings, sound_matches_message } from '../js/sounds.js';

// Captured from macOS 15 libc, with no setlocale(), REG_EXTENDED | REG_NOSUB.
// Pattern and subject code units are bytes, including the UTF-8 byte examples.
const cases = JSON.parse(readFileSync(new URL('./fixtures/darwin-regex.json', import.meta.url), 'utf8'));

for (const [pattern, subject, expected] of cases) {
    test(`Darwin ERE ${JSON.stringify(pattern)} on ${JSON.stringify(subject)}`, () => {
        const compiled = ere_compile(pattern);
        const actual = compiled.error ? `E ${compiled.error}`
            : `M ${Number(new RegExp(compiled.jsSource).test(subject))}`;
        assert.equal(actual, expected);
    });
}

test('SOUND uses the same Darwin ERE compiler', () => {
    release_sound_mappings();
    try {
        assert.equal(add_sound_mapping('MESG "\\d+" "literal-d.wav" 50 1'), 1);
        assert.equal(sound_matches_message('ddd')?.filename, './literal-d.wav');
        assert.equal(sound_matches_message('123'), null);
        assert.equal(add_sound_mapping('MESG "a{256}" "bad.wav" 50 2'), 0);
        assert.equal(add_sound_mapping('MESG "[[.hyphen.]]" "hyphen.wav" 50 3'), 1);
        assert.equal(sound_matches_message('-')?.filename, './hyphen.wav');
    } finally {
        release_sound_mappings();
    }
});

test('config regex callers preserve matching and Darwin error plumbing', async () => {
    const options = await parseNethackrc([
        'MSGTYPE=hide "\\d+"',
        'MENUCOLOR="[[:digit:]]+"=red',
        'AUTOPICKUP_EXCEPTION="<[[.hyphen.]]"',
        'MSGTYPE=hide "a{256}"',
        'MENUCOLOR="a{256}"=red',
        'AUTOPICKUP_EXCEPTION="<a{256}"',
    ].join('\n') + '\n');
    assert.equal(options.msgtypes.length, 1);
    assert.equal(options.msgtypes[0].regex.test('ddd'), true);
    assert.equal(options.msgtypes[0].regex.test('123'), false);
    assert.equal(options.menucolors.length, 1);
    assert.equal(options.menucolors[0].regex.test('123'), true);
    assert.equal(options.apelist.length, 1);
    assert.equal(options.apelist[0].regex.test('-'), true);
    const errors = options.config_error_raw.join('\n');
    assert.match(errors, /MSGTYPE regex error: maximum repetition exceeds 255/);
    assert.match(errors, /Menucolor regex error: maximum repetition exceeds 255/);
    assert.match(errors, /regex error in AUTOPICKUP_EXCEPTION: maximum repetition exceeds 255/);
});
