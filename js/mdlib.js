// mdlib.js — port of src/mdlib.c, the build-information library.
//
// mdlib.c is compiled twice: once into util/makedefs (MAKEDEFS_C) and once into
// the game binary (FOR_RUNTIME).  This is the FOR_RUNTIME copy: it manufactures
// the runtime version number / feature bitmask (make_version), the version and
// banner strings (version_id_string / bannerc_string / mdlib_version_string),
// and the paged "Options compiled into this edition:" text that version.c's
// doextversion() displays (build_options / do_runtime_info).
//
// INERT: nothing in the live path calls anything here yet.  js/version.js's
// VERSION_INFO_LINES holds the same text as a frozen transcription; the
// functions below GENERATE it from the same tables C uses, so a future wiring
// can drop the transcription.  Verified: build_options() + doextversion()'s
// blank-line/header filtering reproduces VERSION_INFO_LINES exactly (modulo two
// trailing spaces that C emits and a terminal cannot show).
//
// All build-time #ifdef results are pinned as named constants in the BUILD
// CONFIGURATION block below.  docs/recording-environment.md rules that the
// recorder's environment strings may be hard-coded; every literal that depends
// on the recorder's build lives in that one block and nowhere else.

/* ─────────────────────────── BUILD CONFIGURATION ───────────────────────────
 * The recorder is the binary described by nethack-c/build-recorder.sh: a macOS
 * clang build of NetHack 5.0.0 with the patches in nethack-c/patches/.  Each
 * constant below stands in for a C compile-time value that JavaScript cannot
 * observe.  Sources are named per line.
 */

/* include/patchlevel.h */
export const VERSION_MAJOR = 5;
export const VERSION_MINOR = 0;
export const PATCHLEVEL = 0;
export const EDITLEVEL = 0;
export const NH_STATUS_RELEASED = 0, NH_STATUS_WIP = 1, NH_STATUS_BETA = 2,
             NH_STATUS_POSTRELEASE = 3;
export const NH_DEVEL_STATUS = NH_STATUS_RELEASED;
/* patchlevel.h: `#define VERSION_COMPATIBILITY 0x05000000L` is commented out */
const VERSION_COMPATIBILITY = null;

/* include/global.h:192 — #define PORT_ID "MacOS" (MACOSX).  PORT_SUB_ID is
   not defined for this port. */
const PORT_ID = 'MacOS';
const PORT_SUB_ID = null;

/* src/hacklib.c datamodel(0) for short=2 int=4 long=8 longlong=8 ptr=8, which
   is what clang gives on macOS x86_64/arm64. */
const DATA_MODEL = 'I32LP64';

/* include/config.h DEFAULT_WINDOW_SYS — the only interface built is tty. */
const DEFAULT_WINDOW_SYS = 'tty';

/* src/date.c populate_nomakedefs(): `__DATE__ " " __TIME__`, which
   nethack-c/patches/001-deterministic-runtime.patch pins so that screen
   captures of the banner compare equal across rebuilds. */
export const MD_BUILD_DATE = 'May  2 2026 12:00:00';

/* mktime() of MD_BUILD_DATE read as LOCAL time.  docs/recording-environment.md
   pins TZ to America/New_York, so that is 2026-05-02 12:00:00 EDT.  Kept as a
   constant because JS Date arithmetic would otherwise follow the HOST zone. */
export const MD_BUILD_TIME = 1777737600;

/* makedefs.c sets mdlib.c's `date_via_env` when REPRODUCIBLE_BUILD reads
   SOURCE_DATE_EPOCH.  That static lives in the MAKEDEFS_C copy of mdlib.c;
   the FOR_RUNTIME copy compiled into the game never sets it, which is why the
   recorded banner says "last build" rather than "last revision". */
const date_via_env = false;

/* onames.h / pm.h / artilist.h counts for this build (make_version's
   entity_count).  NUMMONS includes the mail daemon
   ([[mons-table-missing-mail-daemon]]). */
const NROFARTIFACTS = 33;
const NUM_OBJECTS = 481;
const NUMMONS = 383;

/* include/global.h COLNO; mdlib.c MAXOPT */
const COLNO = 80;
const MAXOPT = 60;

/* ── config.h/unixconf.h #ifdef results, in build_opts[] order ── */
const HAVE_AMIGA_WBENCH = false;
const HAVE_ANSI_DEFAULT = false;
const HAVE_TTY_TILES_ESCCODES = false;
const HAVE_LIFE = false;
const HAVE_COMPRESS = true;
const HAVE_ZLIB_COMP = false;
const HAVE_DLB = false;
const HAVE_VERSION_IN_DLB_FILENAME = false;
const HAVE_EDIT_GETLIN = false;
const HAVE_DUMPLOG = false;
const HAVE_HOLD_LOCKFILE_OPEN = false;
const HAVE_HANGUPHANDLING = true, HAVE_NO_SIGNAL = false, HAVE_SAFERHANGUP = true;
const HAVE_INSURANCE = true;
const HAVE_LIVELOG = true;
const HAVE_LOGFILE = true;
const HAVE_XLOGFILE = true;
const HAVE_PANICLOG = true;
const HAVE_MAIL = true;
/* global.h:430 — unconditional, so a save file always has the mail fields. */
const HAVE_MAIL_STRUCTURES = true;
const HAVE_MONITOR_HEAP = false;
const HAVE_MSDOS_PROTECTED_MODE = false;
const HAVE_NEWS = true;
const HAVE_OVERLAY = false;
const HAVE_UNIX = true, HAVE_DEF_PAGER = false;
const HAVE_USE_ISAAC64 = true;
const DEV_RANDOM = '/dev/random';       /* unixconf.h:428 */
const HAVE_WIN32 = false, HAVE_RANDOM = false;
const HAVE_SELECTSAVED = true;
const HAVE_SCORE_ON_BOTL = false;
const HAVE_CLIPPING = true;
const HAVE_NO_TERMS = false;
const HAVE_SHELL = true;
const HAVE_STATUS_HILITES = true;
const HAVE_SUSPEND = true;
const HAVE_TTY_GRAPHICS = true, HAVE_TERMINFO = true, HAVE_TERMLIB = false;
const HAVE_USE_XPM = false;
const HAVE_GRAPHIC_TOMBSTONE = false;
const HAVE_TIMED_DELAY = false;
const HAVE_PREFIXES_IN_USE = false;
const HAVE_VISION_TABLES = false;
const HAVE_SYSCF = true;
const HAVE_PANICTRACE = true;
const HAVE_CRASHREPORT = true;
const HAVE_USER_SOUNDS = false;
const HAVE_MSVC = false;                /* _MSC_VER */
/* ───────────────────────── end BUILD CONFIGURATION ───────────────────────── */

// C ref: include/hack.h SFCTOOL_BIT — the high feature bit that the standalone
// save-file conversion tool sets and NetHack itself never does.
const SFCTOOL_BIT = 0x80000000;

// ── mdlib.c file statics ──
let idxopttext = 0;
let done_runtime_opt_init_once = 0;
const opttext = new Array(MAXOPT).fill(null);
let optbuf = '';                        /* static char optbuf[COLBUFSZ] */
const opt_indent = '    ';
// C ref: mdlib.c:103 `static struct version_info version;` — zero-initialised.
const version = { incarnation: 0, feature_set: 0, entity_count: 0 };
let save_bones_compat_buf = '';

// C ref: mdlib.c:98 STOREOPTTEXT(line).
function STOREOPTTEXT(line) {
    if (idxopttext < MAXOPT) opttext[idxopttext++] = line;
}

// C ref: mdlib.c:112 window_opts[] — one entry per built windowing system,
// with a { 0, 0, FALSE } fencepost that SIZE()-1 loops stop before.
const window_opts = [
    { id: 'tty', name: 'traditional text with optional line-drawing',
      valid: false },
    { id: null, name: null, valid: false },
];

// C ref: mdlib.c sndprocs.h soundlib_ids — only soundlib_nosound is linked in.
const soundlib_nosound = 0;
const soundlib_opts = [
    { id: soundlib_nosound, text_id: 'soundlib_nosound', Url: '', valid: false },
    { id: 0, text_id: null, Url: null, valid: false },
];

// C ref: mdlib.c:235 md_ignored_features() — feature bits that must NOT make a
// save file incompatible: SCORE_ON_BOTL (a pure display option) and the bit
// SFCTOOL sets on files it converted.
export function md_ignored_features() {
    return (0
            | (1 << 19)      /* SCORE_ON_BOTL */
            | SFCTOOL_BIT    /* stored by SFCTOOL, not NetHack itself */
            ) >>> 0;
}

// C ref: mdlib.c:248 make_version() — build the three save-file version words.
// Called from runtime_info_init() before populate_nomakedefs().
export function make_version() {
    let i;

    /*
     * integer version number
     */
    version.incarnation = ((VERSION_MAJOR << 24)
                           | (VERSION_MINOR << 16)
                           | (PATCHLEVEL << 8)
                           | EDITLEVEL) >>> 0;
    /*
     * encoded feature list
     * Note:  if any of these magic numbers are changed or reassigned,
     * EDITLEVEL in patchlevel.h should be incremented at the same time.
     */
    version.feature_set = (0
/* levels and/or topology (0..4) */
/* monsters (5..9) */
                           | (HAVE_MAIL_STRUCTURES ? (1 << 6) : 0)
/* objects (10..14) */
/* flag bits and/or other global variables (15..26) */
 /* color support always*/  | (1 << 17)
                           | (HAVE_INSURANCE ? (1 << 18) : 0)
                           | (HAVE_SCORE_ON_BOTL ? (1 << 19) : 0)
                           ) >>> 0;
    /*
     * Value used for object & monster sanity check.
     *    (NROFARTIFACTS<<24) | (NUM_OBJECTS<<12) | (NUMMONS<<0)
     * C walks artifact_names[] to its NULL terminator; the count is
     * NROFARTIFACTS.
     */
    for (i = 1; i <= NROFARTIFACTS; i++)
        continue;
    version.entity_count = (i - 1);
    i = NUM_OBJECTS;
    /* the shifts exceed 32 bits once combined, so stay in float arithmetic
       rather than JS's 32-bit bitwise operators */
    version.entity_count = (version.entity_count * 4096) + i;
    i = NUMMONS;
    version.entity_count = (version.entity_count * 4096) + i;
/* free bits in here */
    return;
}

// C ref: mdlib.c:300 mdlib_version_string(outbuf, delim) — "5.0.0", or
// "5.0.0-<EDITLEVEL>" while unreleased.  Returns the string (C fills outbuf).
export function mdlib_version_string(outbuf, delim) {
    void outbuf;
    let s = `${VERSION_MAJOR}${delim}${VERSION_MINOR}${delim}${PATCHLEVEL}`;
    if (NH_DEVEL_STATUS !== NH_STATUS_RELEASED)
        s += `-${EDITLEVEL}`;
    return s;
}

// C ref: mdlib.c:316 version_id_string(outbuf, bufsz, build_date) — the
// outdented first line of the '#version' display, and nomakedefs.version_id.
export function version_id_string(outbuf, bufsz, build_date) {
    void outbuf; void bufsz;
    let subbuf = '', versbuf = '', statusbuf;

    if (NH_DEVEL_STATUS !== NH_STATUS_RELEASED) {
        if (NH_DEVEL_STATUS === NH_STATUS_BETA) statusbuf = ' Beta';
        else if (NH_DEVEL_STATUS === NH_STATUS_WIP) statusbuf = ' Work-in-progress';
        else statusbuf = ' post-release';
    } else {
        statusbuf = '';
    }
    if (PORT_SUB_ID) subbuf = ` ${PORT_SUB_ID}`;

    return `${PORT_ID} NetHack${subbuf} Version `
        + `${mdlib_version_string(versbuf, '.')}${statusbuf} - last `
        + `${date_via_env ? 'revision' : 'build'} ${build_date}.`;
}

// C ref: mdlib.c:349 bannerc_string(outbuf, bufsz, build_date) — line 3 of the
// four-line copyright banner (nomakedefs.copyright_banner_c).  Note the nine
// leading spaces: the indentation is part of the string, not the caller's.
export function bannerc_string(outbuf, bufsz, build_date) {
    void outbuf; void bufsz;
    let subbuf = '', versbuf = '';

    if (PORT_SUB_ID) subbuf = ` ${PORT_SUB_ID}`;
    if (NH_DEVEL_STATUS !== NH_STATUS_RELEASED)
        subbuf += (NH_DEVEL_STATUS === NH_STATUS_BETA) ? ' Beta'
                                                       : ' Work-in-progress';

    return `         Version ${mdlib_version_string(versbuf, '.')} `
        + `${PORT_ID}${subbuf}, ${date_via_env ? 'revised' : 'built'} `
        + `${build_date}.`;
}

// C ref: mdlib.c:375 mkstemp(template) — compiled only under _MSC_VER, whose
// CRT has no POSIX mkstemp.  The recorder is a clang/macOS build so libc's
// mkstemp is used and this body is not part of that binary; the port has no
// file-descriptor table either, so it can only return C's error value.
export function mkstemp(template) {
    void template;
    if (!HAVE_MSVC) return -1;  /* not compiled in for this build */
    return -1;                  /* _mktemp_s()/_open() have no JS counterpart */
}

// C ref: mdlib.c:393 build_savebones_compat_string() — the last real entry of
// build_opts[].  With VERSION_COMPATIBILITY undefined it always names exactly
// one version.
export function build_savebones_compat_string() {
    const uver = VERSION_COMPATIBILITY;
    const cver = ((VERSION_MAJOR << 24)
                  | (VERSION_MINOR << 16)
                  | (PATCHLEVEL << 8)) >>> 0;

    save_bones_compat_buf = 'save and bones files accepted from version';
    if (uver !== null && uver !== cver)
        save_bones_compat_buf += `s ${(uver >>> 24) & 0xff}.`
            + `${(uver >>> 16) & 0xff}.${(uver >>> 8) & 0xff} through `
            + `${VERSION_MAJOR}.${VERSION_MINOR}.${PATCHLEVEL}`;
    else
        save_bones_compat_buf +=
            ` ${VERSION_MAJOR}.${VERSION_MINOR}.${PATCHLEVEL} only`;
    return save_bones_compat_buf;
}

// C ref: mdlib.c:417 build_opts[] — every #ifdef arm is kept so the list can be
// re-derived for a different build by flipping the HAVE_* constants above.  The
// last element is a function because save_bones_compat_buf is filled in at
// runtime by build_savebones_compat_string().
function build_opts_table() {
    const o = [];
    if (HAVE_AMIGA_WBENCH) o.push('Amiga WorkBench support');
    if (HAVE_ANSI_DEFAULT) o.push('ANSI default terminal');
    o.push('color');
    if (HAVE_TTY_GRAPHICS && HAVE_TTY_TILES_ESCCODES)
        o.push('console escape codes for tile hinting');
    if (HAVE_LIFE) o.push("Conway's Game of Life");
    if (HAVE_COMPRESS) o.push('data file compression');
    if (HAVE_ZLIB_COMP) o.push('ZLIB data file compression');
    if (HAVE_DLB)
        o.push(!HAVE_VERSION_IN_DLB_FILENAME
               ? 'data librarian'
               : 'data librarian with a version-dependent name');
    if (HAVE_EDIT_GETLIN)
        o.push('edit getlin - some prompts remember previous response');
    if (HAVE_DUMPLOG) o.push('end-of-game dumplogs');
    if (HAVE_HOLD_LOCKFILE_OPEN) o.push('exclusive lock on level 0 file');
    if (HAVE_HANGUPHANDLING && !HAVE_NO_SIGNAL)
        o.push(HAVE_SAFERHANGUP ? 'deferred handling of hangup signal'
                                : 'immediate handling of hangup signal');
    if (HAVE_INSURANCE) o.push('insurance files for recovering from crashes');
    if (HAVE_LIVELOG) o.push('live logging support');
    if (HAVE_LOGFILE) o.push('log file');
    if (HAVE_XLOGFILE) o.push('extended log file');
    if (HAVE_PANICLOG) o.push('errors and warnings log file');
    if (HAVE_MAIL) o.push('mail daemon');
    if (HAVE_MONITOR_HEAP)
        o.push('monitor heap - record memory usage for later analysis');
    if (HAVE_MSDOS_PROTECTED_MODE) o.push('MSDOS protected mode');
    if (HAVE_NEWS) o.push('news file');
    if (HAVE_OVERLAY) o.push('overlays');
    if (HAVE_UNIX)
        o.push((HAVE_DEF_PAGER && !HAVE_DLB)
               ? 'external pager used for viewing help files'
               : 'internal pager used for viewing help files');
    /* pattern matching method will be substituted by nethack at run time */
    o.push('pattern matching via :PATMATCH:');
    if (HAVE_USE_ISAAC64) {
        o.push('pseudo random numbers generated by ISAAC64');
        if (DEV_RANDOM) o.push(`strong PRNG seed from ${DEV_RANDOM}`);
        else if (HAVE_WIN32) o.push('strong PRNG seed from CNG BCryptGenRandom()');
    } else {
        o.push(HAVE_RANDOM ? 'pseudo random numbers generated by random()'
                           : 'pseudo random numbers generated by C rand()');
    }
    if (HAVE_SELECTSAVED) o.push('restore saved games via menu');
    if (HAVE_SCORE_ON_BOTL) o.push('score on status line');
    if (HAVE_CLIPPING) o.push('screen clipping');
    if (HAVE_NO_TERMS) { /* MACOS9/SCREEN_BIOS/SCREEN_VGA/WIN32CON variants */ }
    if (HAVE_SHELL) o.push('shell command');
    o.push('traditional status display');
    o.push(HAVE_STATUS_HILITES ? 'status via windowport with highlighting'
                               : 'status via windowport without highlighting');
    if (HAVE_SUSPEND) o.push('suspend command');
    if (HAVE_TTY_GRAPHICS) {
        if (HAVE_TERMINFO) o.push('terminal info library');
        else if (HAVE_TERMLIB) o.push('terminal capability library');
    }
    if (HAVE_USE_XPM) o.push('tiles file in XPM format');
    if (HAVE_GRAPHIC_TOMBSTONE) o.push('graphical RIP screen');
    if (HAVE_TIMED_DELAY) o.push('timed wait for display effects');
    if (HAVE_PREFIXES_IN_USE) o.push('variable playground');
    if (HAVE_VISION_TABLES) o.push('vision tables');
    if (HAVE_SYSCF) o.push('system configuration at run-time');
    if (HAVE_PANICTRACE) o.push('show stack trace on error');
    if (HAVE_CRASHREPORT) o.push('launch browser to report issues');
    o.push(save_bones_compat_buf);
    o.push('and basic NetHack features');
    return o;
}

// C ref: mdlib.c:602 count_and_validate_winopts() — mark every built interface
// valid and return the count.  (The WIN32 arm that skips mswin/curses depending
// on how the program was launched is not part of a Unix build.)
export function count_and_validate_winopts() {
    let i, cnt = 0;

    /* window_opts has a fencepost entry at the end */
    for (i = 0; i < window_opts.length - 1; i++) {
        ++cnt;
        window_opts[i].valid = true;
    }
    return cnt;
}

// C ref: mdlib.c:627 count_and_validate_soundlibopts().
export function count_and_validate_soundlibopts() {
    let i, cnt = 0;

    /* soundlib_opts has a fencepost entry at the end */
    for (i = 0; i < soundlib_opts.length - 1; i++) {
        ++cnt;
        soundlib_opts[i].valid = true;
    }
    return cnt;
}

// C ref: mdlib.c:641 opt_out_words(str, length_p) — append the space-separated
// words of `str` to optbuf, flushing a completed line whenever the next word
// would pass column COLNO-5.  `length_p` is C's int* out-parameter, modelled as
// an object with a `.value` field.
export function opt_out_words(str, length_p) {
    let word;

    while (str.length) {
        word = str.indexOf(' ');
        let head = str;
        if (word >= 0) head = str.slice(0, word);   /* *word = '\0' */
        if (length_p.value + head.length > COLNO - 5) {
            STOREOPTTEXT(optbuf);
            optbuf = opt_indent;
            length_p.value = opt_indent.length;
        } else {
            optbuf += ' ';
            length_p.value++;
        }
        optbuf += head;
        length_p.value += head.length;
        str = str.slice(head.length + (word >= 0 ? 1 : 0));
    }
}

// C ref: mdlib.c:669 build_options() — fill opttext[] with the '#version' text.
// The blank entries are deliberate: doextversion() drops them and inserts its
// own separator before each outdented header.
export function build_options() {
    let buf;
    let i, length, winsyscnt, cnt = 0;
    let defwinsys = DEFAULT_WINDOW_SYS;
    let soundlibcnt;

    build_savebones_compat_string();
    const build_opts = build_opts_table();
    STOREOPTTEXT(optbuf);
    const STATUS_ARG = (NH_DEVEL_STATUS !== NH_STATUS_RELEASED)
        ? ((NH_DEVEL_STATUS === NH_STATUS_BETA) ? ' [beta]'
                                                : ' [work-in-progress]')
        : '';
    optbuf = `${opt_indent}NetHack version `
        + `${VERSION_MAJOR}.${VERSION_MINOR}.${PATCHLEVEL}${STATUS_ARG}\n`;
    STOREOPTTEXT(optbuf);
    optbuf = 'Options compiled into this edition:';
    STOREOPTTEXT(optbuf);
    optbuf = '';
    length = { value: COLNO + 1 }; /* force 1st item onto new line */
    buf = `${DATA_MODEL} data model,`;
    opt_out_words(buf, length);
    for (i = 0; i < build_opts.length; i++) {
        buf = build_opts[i] + ((i < build_opts.length - 1) ? ',' : '.');
        opt_out_words(buf, length);
    }
    STOREOPTTEXT(optbuf);
    optbuf = '';
    winsyscnt = count_and_validate_winopts();
    STOREOPTTEXT(optbuf);
    optbuf = `Supported windowing system${(winsyscnt > 1) ? 's' : ''}:`;
    STOREOPTTEXT(optbuf);
    optbuf = '';
    length = { value: COLNO + 1 }; /* force 1st item onto new line */

    for (i = 0; i < window_opts.length - 1; i++) {
        if (!window_opts[i].valid) continue;
        buf = `"${window_opts[i].id}"`;
        if (window_opts[i].name !== window_opts[i].id)
            buf += ` (${window_opts[i].name})`;
        /*
         * 1 : foo.
         * 2 : foo and bar,
         * 3+: for, bar, and quux,
         *
         * 2+ will be followed by " with a default of..."
         */
        buf += (winsyscnt === 1) ? '.'          /* no 'default' */
             : (winsyscnt === 2 && cnt === 0) ? ' and'
             : (cnt === winsyscnt - 2) ? ', and'
             : ',';
        opt_out_words(buf, length);
        cnt++;
    }
    if (cnt > 1) {
        /* loop ended with a comma; opt_out_words() will insert a space */
        buf = `with a default of "${defwinsys}".`;
        opt_out_words(buf, length);
    }

    cnt = 0;
    STOREOPTTEXT(optbuf);
    optbuf = '';
    soundlibcnt = count_and_validate_soundlibopts();
    STOREOPTTEXT(optbuf);
    optbuf = `Supported soundlib${(soundlibcnt > 1) ? 's' : ''}:`;
    STOREOPTTEXT(optbuf);
    optbuf = '';
    length = { value: COLNO + 1 }; /* force 1st item onto new line */

    if (HAVE_USER_SOUNDS) soundlibcnt += 1;
    for (i = 0; i < soundlib_opts.length - 1; i++) {
        let soundlib;

        if (!soundlib_opts[i].valid) continue;
        soundlib = soundlib_opts[i].text_id;
        if (soundlib.startsWith('soundlib_')) soundlib = soundlib.slice(9);
        buf = `"${soundlib}"`;
        /*
         * 1 : foo.
         * 2 : foo and bar.
         * 3+: for, bar, and quux.
         */
        buf += (soundlibcnt === 1 || cnt === soundlibcnt - 1)
             ? '.'                              /* no 'with default' */
             : (soundlibcnt === 2 && cnt === 0) ? ' and'
             : (cnt === soundlibcnt - 2) ? ', and'
             : ',';
        opt_out_words(buf, length);
        cnt++;
    }
    if (HAVE_USER_SOUNDS && cnt > 1) {
        /* loop ended with a comma; opt_out_words() will insert a space */
        buf = 'user sounds.';
        opt_out_words(buf, length);
    }

    STOREOPTTEXT(optbuf);
    optbuf = '';

    {
        /* C ref: mdlib.c:800 lua_info[].  The two trailing spaces (after
           "(the " and "and to ") are in the C source; a terminal cannot show
           them, which is why js/version.js's transcription lacks them. */
        const lua_info = [
 '', "NetHack 5.0.* uses the 'Lua' interpreter to process some data:", '',
 '    :LUACOPYRIGHT:', '',
 /*        1         2         3         4         5         6         7
  1234567890123456789012345678901234567890123456789012345678901234567890123456
  */
 ('    "Permission is hereby granted, free of charge,'
  + ' to any person obtaining'),
 '     a copy of this software and associated documentation files (the ',
 '     "Software"), to deal in the Software without restriction including',
 '     without limitation the rights to use, copy, modify, merge, publish,',
 '     distribute, sublicense, and/or sell copies of the Software, and to ',
 '     permit persons to whom the Software is furnished to do so, subject to',
 '     the following conditions:',
 '     The above copyright notice and this permission notice shall be',
 '     included in all copies or substantial portions of the Software."',
        ];

        /* add lua copyright notice;
           ":TAG:" substitutions are deferred to caller */
        for (i = 0; i < lua_info.length; ++i) {
            STOREOPTTEXT(lua_info[i]);
        }
    }

    /* end with a blank line */
    STOREOPTTEXT('');
    return;
}

// C ref: mdlib.c:835 runtime_info_init() — one-shot; leaves opttext[] populated
// and nomakedefs filled in.
export function runtime_info_init() {
    if (!done_runtime_opt_init_once) {
        done_runtime_opt_init_once = 1;
        build_savebones_compat_string();
        /* construct the current version number */
        make_version();
        populate_nomakedefs(version);           /* date.c */
        idxopttext = 0;
        build_options();
    }
}

// C ref: mdlib.c:849 do_runtime_info(rtcontext) — hand back opttext[] one line
// per call, advancing the caller's cursor; NULL/null ends the sequence.
// `rtcontext` is C's int* out-parameter, modelled as { value }.
export function do_runtime_info(rtcontext) {
    let retval = null;

    if (!done_runtime_opt_init_once)
        runtime_info_init();
    if (idxopttext && rtcontext)
        if (rtcontext.value >= 0 && rtcontext.value < MAXOPT) {
            retval = opttext[rtcontext.value];
            rtcontext.value += 1;
        }
    return retval;
}

// C ref: mdlib.c:864 release_runtime_info() — free opttext[] and nomakedefs so
// a later call rebuilds them.
export function release_runtime_info() {
    while (idxopttext > 0) {
        --idxopttext;
        opttext[idxopttext] = null;
    }
    done_runtime_opt_init_once = 0;
    free_nomakedefs();
}

// ─────────────────────────────────────────────────────────────────────────
// src/date.c — mdlib.c's runtime_info_init()/release_runtime_info() call into
// it, so the two functions it needs live here rather than in a one-function
// module.  `nomakedefs` is the struct version.c reads for every version string.
// ─────────────────────────────────────────────────────────────────────────

let nomakedefs_populated = 0;

// C ref: date.c:25 struct nomakedefs_s nomakedefs — the compile-time
// initialisers are Hack 1.0's, deliberately absurd so an unpopulated struct is
// obvious.
export const nomakedefs = {
    build_date: 'Tue, 28-Jul-87 13:18:57 EDT',
    copyright_banner_c: 'Version 1.0, built Jul 28 13:18:57 1987.',
    git_sha: null,
    git_branch: null,
    git_prefix: null,
    version_string: '1.0.0-0',
    version_id: 'NetHack Version 1.0.0-0 - last build Tue Jul 28 13:18:57 1987.',
    version_number: 0x01010000,
    version_features: 0x00000000,
    ignored_features: 0x00000000,
    version_sanity1: 0x00000000,
    build_time: 554476737,
};

// C ref: date.c:52 populate_nomakedefs(version) — parse `__DATE__ " " __TIME__`
// into a build_time and derive every version string from it.  Called once, from
// runtime_info_init().
export function populate_nomakedefs(version_in) {
    const tmpbuf1 = MD_BUILD_DATE;      /* "%s %s", __DATE__, __TIME__ */
    const mth = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /* "Feb 12 1996 23:59:01"
        01234567890123456789  */
    if (tmpbuf1.length === 20) {
        const t = { tm_year: 0, tm_mon: 0, tm_mday: 0,
                    tm_hour: 0, tm_min: 0, tm_sec: 0 };
        t.tm_year = parseInt(tmpbuf1.substr(7, 4), 10) - 1900;
        const mon = tmpbuf1.substr(0, 3);
        for (let i = 0; i < mth.length; ++i)
            if (mon.toLowerCase() === mth[i].toLowerCase()) { t.tm_mon = i; break; }
        t.tm_mday = parseInt(tmpbuf1.substr(4, 2).replace(/^ /, ''), 10);
        t.tm_hour = parseInt(tmpbuf1.substr(12, 2), 10);
        t.tm_min = parseInt(tmpbuf1.substr(15, 2), 10);
        t.tm_sec = parseInt(tmpbuf1.substr(18, 2), 10);
        /* timeresult = mktime(&t): struct tm is read as LOCAL time, so the
           answer depends on TZ and is pinned as MD_BUILD_TIME rather than
           recomputed from the host clock.  `t` is still parsed so a different
           MD_BUILD_DATE would show up here rather than silently agree. */
        void t;
        nomakedefs.build_time = MD_BUILD_TIME;
        nomakedefs.build_date = tmpbuf1;
    }

    nomakedefs.version_number = version_in.incarnation;
    nomakedefs.version_features = version_in.feature_set;
    nomakedefs.ignored_features = md_ignored_features();
    nomakedefs.version_sanity1 = version_in.entity_count;
    nomakedefs.version_string = mdlib_version_string('', '.');
    nomakedefs.version_id =
        version_id_string('', 0, nomakedefs.build_date);
    nomakedefs.copyright_banner_c =
        bannerc_string('', 0, nomakedefs.build_date);
    /* NETHACK_GIT_SHA / _BRANCH / _PREFIX are not defined for this build, so
       git_sha/git_branch/git_prefix stay NULL and getversionstring() emits no
       " (...)" suffix. */

    nomakedefs_populated = 1;
    return;
}

// C ref: date.c:133 free_nomakedefs() — only the strings populate_nomakedefs()
// allocated get dropped; a never-populated struct keeps its static literals.
export function free_nomakedefs() {
    if (!nomakedefs_populated) return;

    nomakedefs.build_date = null;
    nomakedefs.version_string = null;
    nomakedefs.version_id = null;
    nomakedefs.copyright_banner_c = null;
    nomakedefs.git_sha = null;
    nomakedefs.git_branch = null;
    nomakedefs.git_prefix = null;

    /* values are Null now; dynamic vs static doesn't really matter anymore */
    nomakedefs_populated = 0;
    return;
}
