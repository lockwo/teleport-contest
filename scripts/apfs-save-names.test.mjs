import assert from 'node:assert/strict';
import test from 'node:test';
import { apfsCaseFold } from '../js/apfs.js';

// Native macOS APFS lookups were checked for these pairs and all 1,557
// C/F mappings in Unicode 16.0 CaseFolding.txt.
test('APFS save names use full Unicode folding and canonical normalization', () => {
    for (const [a, b] of [
        ['Bob', 'BOB'], ['José', 'Jose\u0301'], ['Σ', 'ς'],
        ['Straße', 'STRASSE'], ['ẞ', 'ss'], ['ſam', 'sam'], ['ﬃ', 'ffi'],
        ['İ', 'i\u0307'], ['K', 'k'], ['Å', 'Å'], ['µ', 'μ'],
        ['Ꭰ', 'ꭰ'], ['ა', 'Ა'], ['α\u0345\u0301', 'άι'], ['𐐀', '𐐨'],
    ]) assert.equal(apfsCaseFold(a), apfsCaseFold(b), `${a} / ${b}`);
});

test('APFS does not use Turkic or compatibility folding', () => {
    for (const [a, b] of [
        ['ı', 'i'], ['Ａ', 'A'], ['①', '1'],
    ]) assert.notEqual(apfsCaseFold(a), apfsCaseFold(b), `${a} / ${b}`);
});
