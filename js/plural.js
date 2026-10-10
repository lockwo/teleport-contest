// plural.js — objnam.c's pure string routines (makeplural/makesingular and the
// hacklib.c primitives they use), kept in a leaf module so any file can import
// them without pulling in objnam.js's object-naming dependency graph.
// C ref: objnam.c:2550-3239 (singplur_*, makeplural, makesingular),
// hacklib.c (lowc, highc, strcasecpy, ...), objnam.c:137-198 (obuf pool).

const NUMOBUF = 12; /* objnam.c:11 */

function impossible(_msg) { /* the C message goes to the paniclog only */ }

// lowc(): lower-case a single char (ASCII).  C ref: hacklib.c lowc().
export function lowc(c) {
    return c >= 'A' && c <= 'Z' ? c.toLowerCase() : c;
}


// strncmp / strncmpi over the first n chars.
export function strncmp(a, b, n) {
    return a.slice(0, n) === b.slice(0, n);
}
export function strncmpi(a, b, n) {
    return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}
export function strcmpi(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}


export const vowels = 'aeiouAEIOU';

// ── C string primitives (hacklib.c) ───────────────────────────────────────
function highc(c) { return c >= 'a' && c <= 'z' ? c.toUpperCase() : c; }
function letter(c) { return !!c && /[A-Za-z]/.test(c); }

/* objnam.c:66 BSTRCMPI(base, ptr, str): TRUE (non-zero) when ptr is in front of
   base or the tail differs.  `idx` is the C pointer as an index into base. */
function bstrcmpi(base, idx, str) {
    if (idx < 0) return 1;
    return base.slice(idx).toLowerCase() === str.toLowerCase() ? 0 : 1;
}
/* objnam.c:67 BSTRNCMPI */
function bstrncmpi(base, idx, str, num) {
    if (idx < 0) return 1;
    return base.slice(idx, idx + num).toLowerCase()
        === str.slice(0, num).toLowerCase() ? 0 : 1;
}
/* plain strcmpi(ptr, str) where callers guard the pointer with a length test.
   C reads in front of the buffer if a caller's guard is wrong; JS slice() would
   silently count from the END instead, so an out-of-range index answers "no
   match" here. */
function strcmpi_at(s, idx, str) {
    if (idx < 0) return 1;
    return s.slice(idx).toLowerCase() === str.toLowerCase() ? 0 : 1;
}

/* hacklib.c:300 chrcasecpy(oc, nc) — force nc into oc's case. */
function chrcasecpy(oc, nc) {
    if (oc >= 'a' && oc <= 'z') {
        if (nc >= 'A' && nc <= 'Z') return nc.toLowerCase();
    } else if (oc >= 'A' && oc <= 'Z') {
        if (nc >= 'a' && nc <= 'z') return nc.toUpperCase();
    }
    return nc;
}

/* hacklib.c:323 strcasecpy(dst, src) — overwrite dst from `at` onward with src,
   preserving the case of the characters being replaced, then terminate (which
   discards anything after).  Returns the whole new string. */
function strcasecpy(dst, at, src) {
    const arr = dst.split('');
    let d = at, exh = 0;
    for (const ic of src) {
        if (!exh && d >= arr.length) exh = 1; /* C: !*dst */
        const oc = arr[d - exh];
        arr[d] = chrcasecpy(oc === undefined ? '' : oc, ic);
        d++;
    }
    arr.length = d; /* C: *dst = '\0' */
    return arr.join('');
}


/* role.c:688 genders[] — the four rows makeplural()/makesingular()/doname_base()
   read (adj is used by doname_base's wizmgender suffix). */
export const genders = [
    { adj: 'male', he: 'he', him: 'him', his: 'his' },
    { adj: 'female', he: 'she', him: 'her', his: 'her' },
    { adj: 'neuter', he: 'it', him: 'it', his: 'its' },
    { adj: 'group', he: 'they', him: 'them', his: 'their' },
];


// ── obuf pool (objnam.c:137-198) ──────────────────────────────────────────
const obufs = Array.from({ length: NUMOBUF }, () => ({ s: '' }));
let obufidx = 0;

// nextobuf(): rotate to the next of the NUMOBUF work buffers.
// C ref: objnam.c:141.
export function nextobuf() {
    obufidx = (obufidx + 1) % NUMOBUF;
    return obufs[obufidx];
}

// releaseobuf(): give the most recently allocated buffer back.  C tests whether
// bufp points anywhere INSIDE obufs[obufidx] (callers may hold a pointer into
// the middle of it, e.g. &obuf[PREFIX] from xname()); slot identity is the same
// test.  C ref: objnam.c:149.
export function releaseobuf(bufp) {
    if (bufp === obufs[obufidx])
        obufidx = (obufidx - 1 + NUMOBUF) % NUMOBUF;
}
/* every C releaseobuf() call site releases the buffer it just allocated, which
   is the only case the guard above accepts */
export function cur_obuf() { return obufs[obufidx]; }
export function setobuf(ob, s) { ob.s = s; return s; }

// maybereleaseobuf(): display_pickinv()'s hook.  C ref: objnam.c:166.
export function maybereleaseobuf(obuffer) { releaseobuf(obuffer); }


// ── singularize / pluralize (objnam.c:2550-3239) ──────────────────────────
/* strchr(set, c) with an empty/absent c treated as "not found" ('' would match
   every set under String.includes) */
export function strchr(set, c) { return c != null && c !== '' && set.indexOf(c) >= 0; }

/* objnam.c:2662 one_off[] — word pairs that no formula reverses */
const one_off = [
    ['child', 'children'], /* (for wise guys who give their food funny names) */
    ['cubus', 'cubi'],     /* in-/suc-cubus */
    ['culus', 'culi'],     /* homunculus */
    ['Cyclops', 'Cyclopes'],
    ['djinni', 'djinn'],
    ['erinys', 'erinyes'],
    ['foot', 'feet'],
    ['fungus', 'fungi'],
    ['goose', 'geese'],
    ['knife', 'knives'],
    ['labrum', 'labra'],   /* candelabrum */
    ['louse', 'lice'],
    ['mouse', 'mice'],
    ['mumak', 'mumakil'],
    ['nemesis', 'nemeses'],
    ['ovum', 'ova'],
    ['ox', 'oxen'],
    ['passerby', 'passersby'],
    ['rtex', 'rtices'],    /* vortex */
    ['serum', 'sera'],
    ['staff', 'staves'],
    ['tooth', 'teeth'],
];

/* objnam.c:2689 as_is[] */
const as_is = [
    /* makesingular() leaves these plural due to how they're used */
    'boots', 'shoes', 'gloves', 'lenses', 'scales',
    'eyes', 'gauntlets', 'iron bars',
    /* both singular and plural are spelled the same */
    'bison', 'deer', 'elk', 'fish', 'fowl',
    'tuna', 'yaki', '-hai', 'krill', 'manes',
    'moose', 'ninja', 'sheep', 'ronin', 'roshi',
    'shito', 'tengu', 'ki-rin', 'Nazgul', 'gunyoki',
    'piranha', 'samurai', 'shuriken', 'haggis', 'Bordeaux',
];

/* objnam.c:2550 special_subjs[] */
const special_subjs = [
    'erinys', 'manes', /* this one is ambiguous */
    'Cyclops', 'Hippocrates', 'Pelias', 'aklys',
    'amnesia', 'detect monsters', 'paralysis', 'shape changers',
    'nemesis',
];

// badman(): does this *man/*men word take a plain 's' plural / have no *man
// singular?  C ref: objnam.c:3194.
function badman(basestr, to_plural) {
    /* prefixes for *man that don't have a *men plural */
    const no_men = [
        'albu', 'antihu', 'anti', 'ata', 'auto', 'bildungsro', 'cai', 'cay',
        'ceru', 'corner', 'decu', 'des', 'dura', 'fir', 'hanu', 'het',
        'infrahu', 'inhu', 'nonhu', 'otto', 'out', 'prehu', 'protohu',
        'subhu', 'superhu', 'talis', 'unhu', 'sha',
        'hu', 'un', 'le', 're', 'so', 'to', 'at', 'a',
    ];
    /* prefixes for *men that don't have a *man singular */
    const no_man = [
        'abdo', 'acu', 'agno', 'ceru', 'cogno', 'cycla', 'fleh', 'grava',
        'hegu', 'preno', 'sonar', 'speci', 'dai', 'exa', 'fla', 'sta', 'teg',
        'tegu', 'vela', 'da', 'hy', 'lu', 'no', 'nu', 'ra', 'ru', 'se', 'vi',
        'ya', 'o', 'a',
    ];

    if (!basestr || basestr.length < 4)
        return false;

    const endstr = basestr.length;
    const list = to_plural ? no_men : no_man;
    for (const w of list) {
        const al = w.length;
        const spot = endstr - (al + 3);
        if (bstrncmpi(basestr, spot, w, al) === 0
            && (spot === 0 || basestr[spot - 1] === ' '))
            return true;
    }
    return false;
}

// ch_ksound(): *ch words whose 'ch' is a k-sound, so they pluralize with 's'
// rather than 'es'.  C ref: objnam.c:3167.
export function ch_ksound(basestr) {
    const ch_k = [
        'monarch', 'poch', 'tech', 'mech', 'stomach', 'psych',
        'amphibrach', 'anarch', 'atriarch', 'azedarach', 'broch',
        'gastrotrich', 'isopach', 'loch', 'oligarch', 'peritrich',
        'sandarach', 'sumach', 'symposiarch',
    ];

    if (!basestr || basestr.length < 4)
        return false;

    const endstr = basestr.length;
    for (const w of ch_k)
        if (bstrcmpi(basestr, endstr - w.length, w) === 0)
            return true;
    return false;
}

// singplur_lookup(): the singularize/pluralize decisions common to makeplural()
// and makesingular().  C mutates basestr in place via Strcasecpy(), so the
// string is passed BOXED: `sb` is { s } and any transformation is written back
// to sb.s.  C ref: objnam.c:2707.
export function singplur_lookup(sb, endstring, to_plural, alt_as_is) {
    const basestr = sb.s;
    const baselen = basestr.length;
    let al;

    for (const as of as_is) {
        al = as.length;
        if (bstrcmpi(basestr, endstring - al, as) === 0)
            return true;
    }
    if (alt_as_is) {
        for (const as of alt_as_is) {
            al = as.length;
            if (bstrcmpi(basestr, endstring - al, as) === 0)
                return true;
        }
    }

    /* Leave "craft" as a suffix as-is (aircraft, hovercraft) */
    if (baselen > 5 && bstrcmpi(basestr, endstring - 5, 'craft') === 0)
        return true;
    /* avoid false hit on one_off[].plur == "lice" or .sing == "goose" */
    if (strcmpi(basestr, 'slice') || strcmpi(basestr, 'mongoose')) {
        if (to_plural)
            sb.s = strcasecpy(basestr, endstring, 's');
        return true;
    }
    /* skip "ox" -> "oxen" when pluralizing "<something>ox" unless muskox */
    if (to_plural && baselen > 2 && strcmpi_at(basestr, endstring - 2, 'ox') === 0
        && !(baselen > 5 && strcmpi_at(basestr, endstring - 6, 'muskox') === 0)) {
        sb.s = strcasecpy(basestr, endstring, 'es'); /* "fox" -> "foxes" */
        return true;
    }
    if (to_plural) {
        if (baselen > 2 && strcmpi_at(basestr, endstring - 3, 'man') === 0
            && badman(basestr, to_plural)) {
            sb.s = strcasecpy(basestr, endstring, 's');
            return true;
        }
    } else {
        if (baselen > 2 && strcmpi_at(basestr, endstring - 3, 'men') === 0
            && badman(basestr, to_plural))
            return true;
    }
    for (const [sing, plural] of one_off) {
        /* check whether endstring already matches */
        const same = to_plural ? plural : sing;
        al = same.length;
        if (bstrcmpi(basestr, endstring - al, same) === 0)
            return true; /* use as-is */
        /* check whether it matches the inverse; if so, transform it */
        const other = to_plural ? sing : plural;
        al = other.length;
        if (bstrcmpi(basestr, endstring - al, other) === 0) {
            sb.s = strcasecpy(basestr, endstring - al, same);
            return true; /* one_off[] transformation */
        }
    }
    return false;
}

// singplur_compound(): index of a compound-phrase separator (" of ", " called ",
// ...) or -1.  C ref: objnam.c:2782.  js/readobjnam.js:200 has the live copy.
function singplur_compound(str) {
    const compounds = [
        ' of ', ' labeled ', ' called ',
        ' named ', ' above', /* lurkers above */
        ' versus ', ' from ', ' in ',
        ' on ', ' a la ', ' with', /* " with "? */
        ' de ', " d'", ' du ',
        ' au ', '-in-', '-at-',
    ];
    const compound_start = ' -';

    for (let p = 0; p < str.length; ++p) {
        if (compound_start.indexOf(str[p]) < 0)
            continue;
        for (const cmpd of compounds)
            if (str.slice(p, p + cmpd.length).toLowerCase() === cmpd.toLowerCase())
                return p;
    }
    return -1;
}

// makeplural(): the objnam.c plural routine.  C ref: objnam.c:2835.
export function makeplural(oldstr) {
    const ob = nextobuf();
    let str, excess = null, spot, len, lo_c, i;

    if (oldstr != null)
        oldstr = String(oldstr).replace(/^ +/, '');
    if (oldstr == null || oldstr === '') {
        impossible('plural of null?');
        return setobuf(ob, 's');
    }
    /* pronouns: "he"/"she"/"it" -> "they", &c */
    str = '';
    for (i = 0; i <= 2; ++i) {
        if (strcmpi(genders[i].he, oldstr))
            str = genders[3].he; /* "they" */
        else if (strcmpi(genders[i].him, oldstr))
            str = genders[3].him; /* "them" */
        else if (strcmpi(genders[i].his, oldstr))
            str = genders[3].his; /* "their" */
        if (str) {
            if (oldstr[0] === highc(oldstr[0]))
                str = highc(str[0]) + str.slice(1);
            return setobuf(ob, str);
        }
    }

    str = oldstr;
    bottom: {
        /* Skip changing "pair of" to "pairs of" (objnam.c:2873) */
        if (strncmpi(str, 'pair of ', 8))
            break bottom;

        /* look for "foo of bar" so that we can focus on "foo" */
        const ci = singplur_compound(str);
        if (ci >= 0) {
            excess = oldstr.slice(ci);
            str = str.slice(0, ci);
            spot = ci;
        } else {
            spot = str.length;
        }

        spot--;
        while (spot > 0 && str[spot] === ' ')
            spot--; /* Strip blanks from end */
        str = str.slice(0, spot + 1);
        /* Now spot is the last character of the string */
        len = str.length;

        /* Single letters */
        if (len === 1 || !letter(str[spot])) {
            str = str.slice(0, spot + 1) + "'s";
            break bottom;
        }

        /* dispense with some words which don't need pluralization */
        {
            const already_plural = [
                'ae',    /* algae, larvae, &c */
                'eaux',  /* chateaux, gateaux */
                'matzot',
            ];
            /* spot+1: synch up with makesingular's usage */
            const sb = { s: str };
            const hit = singplur_lookup(sb, spot + 1, true, already_plural);
            str = sb.s;
            if (hit)
                break bottom;

            /* more of same, but not suitable for blanket loop checking */
            if ((len === 2 && strcmpi(str, 'ya'))
                || (len >= 3 && strcmpi_at(str, spot - 2, ' ya') === 0))
                break bottom;
        }

        /* man/men ("Wiped out all cavemen.") */
        if (len >= 3 && strcmpi_at(str, spot - 2, 'man') === 0
            /* exclude shamans and humans etc */
            && !badman(str, true)) {
            str = strcasecpy(str, spot - 1, 'en');
            break bottom;
        }
        if (lowc(str[spot]) === 'f') { /* (staff handled via one_off[]) */
            lo_c = lowc(str[spot - 1]);
            if (len >= 3 && strcmpi_at(str, spot - 2, 'erf') === 0) {
                /* avoid "nerf" -> "nerves", "serf" -> "serves"; fall through */
            } else if (strchr('lr', lo_c) || strchr(vowels, lo_c)) {
                str = strcasecpy(str, spot, 'ves'); /* [aeioulr]f -> ves */
                break bottom;
            }
        }
        /* ium/ia (mycelia, baluchitheria) */
        if (len >= 3 && strcmpi_at(str, spot - 2, 'ium') === 0) {
            str = strcasecpy(str, spot - 2, 'ia');
            break bottom;
        }
        /* algae, larvae, hyphae (another fungus part) */
        if ((len >= 4 && strcmpi_at(str, spot - 3, 'alga') === 0)
            || (len >= 5
                && (strcmpi_at(str, spot - 4, 'hypha') === 0
                    || strcmpi_at(str, spot - 4, 'larva') === 0))
            || (len >= 6 && strcmpi_at(str, spot - 5, 'amoeba') === 0)
            || (len >= 8 && strcmpi_at(str, spot - 7, 'vertebra') === 0)) {
            str = strcasecpy(str, spot + 1, 'e'); /* a to ae */
            break bottom;
        }
        /* fungus/fungi, homunculus/homunculi, but buses, lotuses, wumpuses */
        if (len > 3 && strcmpi_at(str, spot - 1, 'us') === 0
            && !((len >= 5 && strcmpi_at(str, spot - 4, 'lotus') === 0)
                 || (len >= 6 && strcmpi_at(str, spot - 5, 'wumpus') === 0))) {
            str = strcasecpy(str, spot - 1, 'i');
            break bottom;
        }
        /* sis/ses (nemesis) */
        if (len >= 3 && strcmpi_at(str, spot - 2, 'sis') === 0) {
            str = strcasecpy(str, spot - 1, 'es');
            break bottom;
        }
        /* -eau/-eaux (gateau, chapeau...) */
        if (len >= 3 && strcmpi_at(str, spot - 2, 'eau') === 0
            /* 'bureaus' is the more common plural of 'bureau' */
            && bstrcmpi(str, spot - 5, 'bureau') !== 0) {
            str = strcasecpy(str, spot + 1, 'x');
            break bottom;
        }
        /* matzoh/matzot, possible food name */
        if (len >= 6
            && (strcmpi_at(str, spot - 5, 'matzoh') === 0
                || strcmpi_at(str, spot - 5, 'matzah') === 0)) {
            str = strcasecpy(str, spot - 1, 'ot'); /* oh/ah -> ot */
            break bottom;
        }
        if (len >= 5
            && (strcmpi_at(str, spot - 4, 'matzo') === 0
                || strcmpi_at(str, spot - 4, 'matza') === 0)) {
            str = strcasecpy(str, spot, 'ot'); /* o/a -> ot */
            break bottom;
        }

        /* note: ox/oxen, VAX/VAXen, goose/geese */

        lo_c = lowc(str[spot]);

        /* codex/spadix/neocortex and the like */
        if (len >= 5
            && (strcmpi_at(str, spot - 2, 'dex') === 0
                || strcmpi_at(str, spot - 2, 'dix') === 0
                || strcmpi_at(str, spot - 2, 'tex') === 0)
            /* indices would have been ok too, but stick with indexes */
            && strcmpi_at(str, spot - 4, 'index') !== 0) {
            str = strcasecpy(str, spot - 1, 'ices'); /* ex|ix -> ices */
            break bottom;
        }
        /* Ends in z, x, s, ch, sh; add an "es" */
        if (strchr('zxs', lo_c)
            || (len >= 2 && lo_c === 'h' && strchr('cs', lowc(str[spot - 1]))
                /* 21st century k-sound */
                && !(len >= 4 && lowc(str[spot - 1]) === 'c' && ch_ksound(str)))
            /* Kludge to get "tomatoes" and "potatoes" right */
            || (len >= 4 && strcmpi_at(str, spot - 2, 'ato') === 0)
            || (len >= 5 && strcmpi_at(str, spot - 4, 'dingo') === 0)) {
            str = strcasecpy(str, spot + 1, 'es');
            break bottom;
        }
        /* Ends in y preceded by consonant (note: also "qu") change to "ies" */
        if (lo_c === 'y' && !strchr(vowels, lowc(str[spot - 1]))) {
            str = strcasecpy(str, spot, 'ies');
            break bottom;
        }
        /* Default: append an 's' */
        str = strcasecpy(str, spot + 1, 's');
    }

    if (excess != null)
        str += excess;
    return setobuf(ob, str);
}

// makesingular(): the faithful objnam.c:3036 makesingular().
export function makesingular(oldstr) {
    const ob = nextobuf();
    let bp, excess = null, p;

    if (oldstr != null)
        oldstr = String(oldstr).replace(/^ +/, '');
    if (oldstr == null || oldstr === '') {
        impossible('singular of null?');
        return setobuf(ob, '');
    }
    /* makeplural() of pronouns isn't reversible but we can force a singular */
    let str = '';
    if (strcmpi(genders[3].he, oldstr))        /* "they" */
        str = genders[2].he;                   /* "it" */
    else if (strcmpi(genders[3].him, oldstr))  /* "them" */
        str = genders[2].him;                  /* also "it" */
    else if (strcmpi(genders[3].his, oldstr))  /* "their" */
        str = genders[2].his;                  /* "its" */
    if (str) {
        if (oldstr[0] === highc(oldstr[0]))
            str = highc(str[0]) + str.slice(1);
        return setobuf(ob, str);
    }

    bp = oldstr;
    bottom: {
        /* check for "foo of bar" so that we can focus on "foo" */
        const ci = singplur_compound(bp);
        if (ci >= 0) {
            excess = oldstr.slice(ci);
            bp = bp.slice(0, ci);
            p = ci;
        } else {
            p = bp.length;
        }

        /* dispense with some words which don't need singularization */
        {
            const sb = { s: bp };
            const hit = singplur_lookup(sb, p, false, special_subjs);
            bp = sb.s;
            if (hit)
                break bottom;
        }

        /* remove -s or -es (boxes) or -ies (rubies) */
        if (p >= 1 && lowc(bp[p - 1]) === 's') {
            mins: {
                if (p >= 2 && lowc(bp[p - 2]) === 'e') {
                    if (p >= 3 && lowc(bp[p - 3]) === 'i') { /* "ies" */
                        if (bstrcmpi(bp, p - 7, 'cookies') === 0
                            || (bstrcmpi(bp, p - 4, 'pies') === 0
                                /* avoid false match for "harpies" */
                                && (p - 4 === 0 || bp[p - 5] === ' '))
                            /* alternate djinni/djinn spelling */
                            || (bstrcmpi(bp, p - 6, 'genies') === 0
                                /* avoid false match for "progenies" */
                                && (p - 6 === 0 || bp[p - 7] === ' '))
                            || bstrcmpi(bp, p - 5, 'mbies') === 0  /* zombie */
                            || bstrcmpi(bp, p - 5, 'yries') === 0) /* valkyrie */
                            break mins;
                        bp = strcasecpy(bp, p - 3, 'y'); /* ies -> y */
                        break bottom;
                    }
                    /* wolves, but f to ves isn't fully reversible */
                    if (p - 4 >= 0
                        && (strchr('lr', lowc(bp[p - 4]))
                            || strchr(vowels, lowc(bp[p - 4])))
                        && bstrcmpi(bp, p - 3, 'ves') === 0) {
                        if (bstrcmpi(bp, p - 6, 'cloves') === 0
                            || bstrcmpi(bp, p - 6, 'nerves') === 0)
                            break mins;
                        bp = strcasecpy(bp, p - 3, 'f'); /* ves -> f */
                        break bottom;
                    }
                    /* note: nurses, axes but boxes, wumpuses */
                    if (bstrcmpi(bp, p - 4, 'eses') === 0
                        || bstrcmpi(bp, p - 4, 'oxes') === 0  /* boxes, foxes */
                        || bstrcmpi(bp, p - 4, 'nxes') === 0  /* lynxes */
                        || bstrcmpi(bp, p - 4, 'ches') === 0
                        || bstrcmpi(bp, p - 4, 'uses') === 0  /* lotuses */
                        || bstrcmpi(bp, p - 4, 'shes') === 0  /* splashes */
                        || bstrcmpi(bp, p - 4, 'sses') === 0  /* priestesses */
                        || bstrcmpi(bp, p - 5, 'atoes') === 0 /* tomatoes */
                        || bstrcmpi(bp, p - 7, 'dingoes') === 0
                        || bstrcmpi(bp, p - 7, 'Aleaxes') === 0) {
                        bp = bp.slice(0, p - 2); /* drop es */
                        break bottom;
                    } /* else fall through to mins */

                    /* ends in 's' but not 'es' */
                } else if (bstrcmpi(bp, p - 2, 'us') === 0) { /* lotus, fungus */
                    if (bstrcmpi(bp, p - 6, 'tengus') !== 0 /* but not these... */
                        && bstrcmpi(bp, p - 7, 'hezrous') !== 0)
                        break bottom;
                } else if (bstrcmpi(bp, p - 2, 'ss') === 0
                           || bstrcmpi(bp, p - 5, ' lens') === 0
                           || (p - 4 === 0 && strcmpi_at(bp, p - 4, 'lens') === 0)) {
                    break bottom;
                }
            }
            bp = bp.slice(0, p - 1); /* mins: drop s */

        } else { /* input doesn't end in 's' */

            if (bstrcmpi(bp, p - 3, 'men') === 0 && !badman(bp, false)) {
                bp = strcasecpy(bp, p - 2, 'an');
                break bottom;
            }
            /* matzot -> matzo, algae -> alga */
            if (bstrcmpi(bp, p - 6, 'matzot') === 0
                || bstrcmpi(bp, p - 2, 'ae') === 0
                || bstrcmpi(bp, p - 4, 'eaux') === 0) {
                bp = bp.slice(0, p - 1); /* drop t/e/x */
                break bottom;
            }
            /* balactheria -> balactherium */
            if (p - 4 >= 0 && strcmpi_at(bp, p - 2, 'ia') === 0
                && strchr('lr', lowc(bp[p - 3])) && lowc(bp[p - 4]) === 'e') {
                bp = strcasecpy(bp, p - 1, 'um'); /* a -> um */
            }

            /* here we cannot find the plural suffix */
        }
    }

    /* if we stripped off a suffix (" of bar" from "foo of bar"), put it back */
    if (excess != null)
        bp += excess;
    return setobuf(ob, bp);
}


// vtense(): objnam.c:2563 vtense(subj, verb) — `verb` arrives in the plural (no
// trailing s); it is returned unchanged when `subj` reads as plural, else the
// 3rd person singular present form.  A null subject takes the singular form
// straight away (the `sing:` arm other callers use for fixed subjects).  The
// plural test is deliberately sloppy in C ("anything ending in 's' but not
// '*us' or '*ss'") and special_subjs[] ("Pelias", "Cyclops", "erinys", ...)
// carves out the false matches, so this one copy replaces every reduced
// private vtense() that lacked the carve-out.
export function vtense(subj, verb) {
    verb = String(verb);
    if (subj != null && subj !== '') {
        const s = String(subj);
        if (!(strncmpi(s, 'a ', 2) || strncmpi(s, 'an ', 3))) {
            /* the head noun ends before a " of "/" from "/... qualifier */
            let spot = -1;
            const quals = [' of ', ' from ', ' called ', ' named ', ' labeled '];
            for (let sp = s.indexOf(' '); sp >= 0; sp = s.indexOf(' ', sp + 1)) {
                if (quals.some((q) => strncmpi(s.slice(sp), q, q.length))) {
                    if (sp !== 0) spot = sp - 1;
                    break;
                }
            }
            if (spot < 0) spot = s.length - 1;
            /* BSTRNCMPI(subj, spot - n + 1, str, n): false when it would start
               before the buffer */
            const tail = (str) => spot - str.length + 1 >= 0
                && s.slice(spot - str.length + 1, spot + 1).toLowerCase() === str;
            if ((lowc(s[spot]) === 's' && spot !== 0
                 && !strchr('us', lowc(s[spot - 1])))
                || tail('eeth') || tail('feet') || tail('ia') || tail('ae')) {
                /* check for special cases to avoid false matches */
                const len = spot + 1;
                for (const spec of special_subjs) {
                    const ltmp = spec.length;
                    if (len === ltmp && strncmpi(spec, s, len)) return vtense_sing(verb);
                    /* also check for <prefix><space><special_subj>
                       to catch things like "the invisible erinys" */
                    if (len > ltmp && s[spot - ltmp] === ' '
                        && strncmpi(spec, s.slice(spot - ltmp + 1), ltmp))
                        return vtense_sing(verb);
                }
                return verb;
            }
            /* 3rd person plural doesn't end in telltale 's';
               2nd person singular is "you" */
            if (strcmpi(s, 'they') || strcmpi(s, 'you'))
                return verb;
        }
    }
    return vtense_sing(verb);
}

// objnam.c:2630 vtense() `sing:` arm.
function vtense_sing(verb) {
    const len = verb.length;
    const last = lowc(verb[len - 1]);
    if (strcmpi(verb, 'are')) return 'is';
    if (strcmpi(verb, 'have')) return `${verb.slice(0, -2)}s`;
    if (strchr('zxs', last)
        || (len >= 2 && last === 'h' && strchr('cs', lowc(verb[len - 2])))
        || (len === 2 && last === 'o'))
        return `${verb}es`;
    if (last === 'y' && !strchr(vowels, lowc(verb[len - 2])))
        return `${verb.slice(0, -1)}ies`;
    return `${verb}s`;
}
