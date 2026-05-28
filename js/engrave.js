// engrave.js - engraving text selection and degradation.
// C refs: engrave.c random_engraving(), wipeout_text(), wipe_engr_at().

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { BUFSZ, BURN, DUST, ENGR_BLOOD, HEADSTONE, ICE } from './const.js';

const MD_PAD_RUMORS = 60;

const ENGRAVE_TEXTS = [
    'No matter where you go, there you are.',
    'Elbereth',
    'Vlad was here',
    'ad aerarium',
    'Owlbreath',
    'Galadriel',
    'Kilroy was here',
    'Frodo lives',
    'A.S. ->',
    '<- A.S.',
    "You won't get it up the steps",
    "Lasciate ogni speranza o voi ch'entrate.",
    'Well Come',
    'We apologize for the inconvenience.',
    'See you next Wednesday',
    'notary sojak',
    'For a good time call 8?7-5309',
    "Please don't feed the animals.",
    "Madam, in Eden, I'm Adam.",
    'Two thumbs up!',
    'Hello, World!',
    "You've got mail!",
    'As if!',
    'BAD WOLF',
    'Arooo!  Werewolves of Yendor!',
    'Dig for Victory here',
    'Gaius Julius Primigenius was here.  Why are you late?',
    "Don't go this way",
    'Go left --->',
    '<--- Go right',
    'X marks the spot',
    'X <--- You are here.',
    'Here be dragons',
    'Save now, and do your homework!',
    "There was a hole here.  It's gone now.",
    'The Vibrating Square',
    'This is a pit!',
    'This is not the dungeon you are looking for.',
    "Watch out, there's a gnome with a wand of death behind that door!",
    'This square deliberately left blank.',
    'Haermund Hardaxe carved these runes',
    "Need a light?  Come visit the Minetown branch of Izchak's Lighting Store!",
    'Snakes on the Astral Plane - Soon in a dungeon near you',
    'You are the one millionth visitor to this place!  Please wait 200 turns for your wand of wishing.',
    'Warning, Exploding runes!',
    'If you can read these words then you are not only a nerd but probably dead.',
    'The cake is a lie',
];

const FALSE_RUMOR_SIZE = 25762;
const TRUE_RUMOR_SIZE = 24924;
const KNOWN_TRUE_RUMORS = new Map([
    [3453, 'Elven cloaks cannot rust.'],
    [19566, 'They say that tengu never steal gold although they would be good at it.'],
]);
const KNOWN_FALSE_RUMORS = new Map([
    [5789, 'If you want to feel great, you must eat something real big.'],
    [7767, 'Never mind the monsters hitting you:  they just replace the charwomen.'],
    [15312, 'They say that building a dungeon is a team effort.'],
]);

const rubouts = [
    ['A', '^'],
    ['B', 'Pb['],
    ['C', '('],
    ['D', '|)['],
    ['E', '|FL[_'],
    ['F', '|-'],
    ['G', 'C('],
    ['H', '|-'],
    ['I', '|'],
    ['K', '|<'],
    ['L', '|_'],
    ['M', '|'],
    ['N', '|\\'],
    ['O', 'C('],
    ['P', 'F'],
    ['Q', 'C('],
    ['R', 'PF'],
    ['T', '|'],
    ['U', 'J'],
    ['V', '/\\'],
    ['W', 'V/\\'],
    ['Z', '/'],
    ['b', '|'],
    ['d', 'c|'],
    ['e', 'c'],
    ['g', 'c'],
    ['h', 'n'],
    ['j', 'i'],
    ['k', '|'],
    ['l', '|'],
    ['m', 'nr'],
    ['n', 'r'],
    ['o', 'c'],
    ['q', 'c'],
    ['w', 'v'],
    ['y', 'v'],
    [':', '.'],
    [';', ',:'],
    [',', '.'],
    ['=', '-'],
    ['+', '-|'],
    ['*', '+'],
    ['@', '0'],
    ['0', 'C('],
    ['1', '|'],
    ['6', 'o'],
    ['7', '/'],
    ['8', '3o'],
];

function padded_line_length(text, padlength = MD_PAD_RUMORS) {
    const len = text.length + 1; // generated files include a newline
    return len <= padlength ? padlength : len;
}

function get_rnd_line(lines, rng, padlength = MD_PAD_RUMORS) {
    const lengths = lines.map((line) => padded_line_length(line, padlength));
    const filechunksize = lengths.reduce((sum, len) => sum + len, 0);
    if (filechunksize < 1) return '';

    let idx = 0;
    let offset_in_line = 0;
    for (let trylimit = 10; trylimit > 0; --trylimit) {
        let chunkoffset = rng(filechunksize);
        let pos = 0;
        for (idx = 0; idx < lengths.length; idx++) {
            if (chunkoffset < pos + lengths[idx]) break;
            pos += lengths[idx];
        }
        if (idx >= lengths.length) idx = lengths.length - 1;
        offset_in_line = chunkoffset - pos;
        if (!padlength || lengths[idx] - offset_in_line <= padlength + 1)
            break;
    }

    const next = (idx + 1 >= lines.length) ? 0 : idx + 1;
    return lines[next];
}

function get_rnd_text_engrave() {
    return get_rnd_line(ENGRAVE_TEXTS, rn2, MD_PAD_RUMORS);
}

function synthetic_rumor(offset, size) {
    const len = 20 + (offset % 41);
    return 'x'.repeat(Math.min(len, size ? 60 : len));
}

function getrumor(truth, exclude_cookie) {
    const cookie_marker = '[cookie] ';
    let rumor = '';
    let count = 0;

    do {
        const adjtruth = truth + rn2(2);
        if (adjtruth > 0) {
            const offset = rn2(TRUE_RUMOR_SIZE);
            rumor = KNOWN_TRUE_RUMORS.get(offset) ?? synthetic_rumor(offset, TRUE_RUMOR_SIZE);
        } else {
            const offset = rn2(FALSE_RUMOR_SIZE);
            rumor = KNOWN_FALSE_RUMORS.get(offset) ?? synthetic_rumor(offset, FALSE_RUMOR_SIZE);
        }
    } while (count++ < 50 && exclude_cookie && rumor.startsWith(cookie_marker));

    if (!exclude_cookie && rumor.startsWith(cookie_marker))
        rumor = rumor.slice(cookie_marker.length);
    return rumor;
}

export function random_engraving() {
    let pristine = '';
    if (!rn2(4) || !(pristine = getrumor(0, true)) || !pristine)
        pristine = get_rnd_text_engrave();

    const text = wipeout_text(pristine, Math.trunc(pristine.length / 4), 0);
    return { text, pristine };
}

export function wipeout_text(engr, cnt, seed = 0) {
    const chars = Array.from(engr);
    let lth = chars.length;

    if (lth && cnt > 0) {
        while (cnt--) {
            let nxt, use_rubout;
            if (!seed) {
                nxt = rn2(lth);
                use_rubout = rn2(4);
            } else {
                nxt = seed % lth;
                seed *= 31;
                seed %= (BUFSZ - 1);
                use_rubout = seed & 3;
            }

            const ch = chars[nxt];
            if (ch === ' ') continue;
            if ("?. ,'`-|_".includes(ch) && ch !== ' ') {
                chars[nxt] = ' ';
                continue;
            }

            let found = false;
            if (use_rubout) {
                for (const [wipefrom, wipeto] of rubouts) {
                    if (ch === wipefrom) {
                        let j;
                        if (!seed) {
                            j = rn2(wipeto.length);
                        } else {
                            seed *= 31;
                            seed %= (BUFSZ - 1);
                            j = seed % wipeto.length;
                        }
                        chars[nxt] = wipeto[j];
                        found = true;
                        break;
                    }
                }
            }

            if (!found)
                chars[nxt] = '?';
        }
    }

    while (lth && chars[lth - 1] === ' ') {
        chars.pop();
        --lth;
    }
    return chars.join('');
}

export function engr_at(x, y) {
    const engravings = game.level?.engravings ?? [];
    return engravings.find((ep) => ep.engr_x === x && ep.engr_y === y) ?? null;
}

export function make_engr_at(x, y, text, pristine, epoch, engr_type) {
    if (!game.level) return null;
    if (!game.level.engravings) game.level.engravings = [];
    game.level.engravings = game.level.engravings.filter(
        (ep) => ep.engr_x !== x || ep.engr_y !== y,
    );
    const ep = {
        engr_x: x,
        engr_y: y,
        engr_type,
        engr_time: epoch,
        nowipeout: false,
        actualText: text,
        rememberedText: text,
        pristineText: pristine ?? text,
    };
    game.level.engravings.unshift(ep);
    return ep;
}

export function wipe_engr_at(x, y, cnt, magical = false) {
    const ep = engr_at(x, y);
    if (!ep || ep.engr_type === HEADSTONE || ep.nowipeout) return;

    const loc = game.level?.at(x, y);
    const on_ice = loc?.typ === ICE;
    if (ep.engr_type !== BURN || on_ice || (magical && !rn2(2))) {
        if (ep.engr_type !== DUST && ep.engr_type !== ENGR_BLOOD)
            cnt = rn2(1 + Math.trunc(50 / (cnt + 1))) ? 0 : 1;
        ep.actualText = wipeout_text(ep.actualText, cnt, 0).replace(/^ +/, '');
        if (!ep.actualText && game.level?.engravings) {
            game.level.engravings = game.level.engravings.filter((e) => e !== ep);
        }
    }
}
