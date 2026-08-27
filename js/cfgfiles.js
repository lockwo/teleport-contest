// js/cfgfiles.js — port of src/cfgfiles.c (config file / sysconf handling).
//
// STATUS: INERT.  Nothing in js/ imports this file yet, and nothing here is
// called from existing code.  The live config reader today is
// js/options.js parseNethackrc(), which holds a working ADAPTATION of
// cfgfiles.c's non-SYSCF surface: config_error_init/_nextline/_add/_done,
// parse_config_line(), is_config_section(), handle_config_section(),
// find_optparam(), get_uchars() and the 27 non-syscnf cnf_line_*() functions,
// plus parse_conf_buf()'s line loop inlined into parseNethackrc() itself.
// This file adds the parts that have no port at all:
//
//   * the 28 syscnf-only cnf_line_*() statements.  SYSCF is defined in this
//     build (config.h:233) and sys/unix/sysconf ships WIZARDS, EXPLORERS,
//     GENERICUSERS, MAXPLAYERS, GDBPATH, GREPPATH, PANICTRACE_GDB and
//     PANICTRACE_LIBC, so these run for real in C before the player's rc is
//     even opened.
//   * the C-shaped parser: cnf_parser_init/_done(), parse_conf_buf(),
//     parse_conf_str(), parse_conf_file(), read_config_file().
//   * fopen_config_file() and the configfile[] name accessors.
//   * rcfile() / rcfile_interface_options() and the heed/disregard switches.
//
// TWO THINGS TO KNOW BEFORE WIRING ANY OF IT UP.
//
// 1. parse_conf_buf() below is a SECOND copy of the loop parseNethackrc()
//    inlines.  Do not let the two drift: when parse_conf_file() is wired up,
//    parseNethackrc()'s inline loop should go away in the same change.
//
// 2. choose_random_part() draws rn2().  C makes that draw while reading the rc
//    file, i.e. before anything else in the game; parseNethackrc() deliberately
//    does NOT (it parks CHOOSE on a sentinel) because taking the draw would
//    shift every later draw in the session.  Wiring the CHOOSE branch up is a
//    measured change, not a free one.
//
// C source: nethack-c/upstream/src/cfgfiles.c (2076 lines).

import { rn2 } from './rng.js';
import { vfsReadFile } from './storage.js';
import {
    raw_print, wait_synch,
    config_error_init, config_error_add, config_error_done,
    config_error_nextline,
    find_optparam, match_optname, handle_config_section, parse_config_line,
    parseoptions, reset_duplicate_opt_detection,
    CONFIG_LINE_STMT,
} from './options.js';

// A cross-file C function this module calls that has no port yet.  These throw
// rather than no-op on purpose: a silent no-op would let a wired-up caller look
// correct while quietly skipping C behaviour, which is the worse failure.
function unported(what) {
    throw new Error(`cfgfiles.js: ${what} has no JS port yet`);
}

const BUFSZ = 256;              /* global.h */
const ECMD_OK = 0x00;           /* hack.h */
const SYSCF_FILE = 'sysconf';   /* config.h:234 */
const LL_NONE = 0x0000;         /* global.h:493 */

// C ref: global.h:579 enum optset_restrictions — read_config_file()'s and
// fopen_config_file()'s `src` argument.
export const set_in_sysconf = 0, set_in_config = 1;

// C ref: global.h:591 enum option_phases — go.opt_phase, which rcfile() sets
// so that parseoptions() can tell where a setting came from.
const phase_not_set = 0, builtin_opt = 1, syscf_opt = 2, rc_file_opt = 3,
      environ_opt = 4, cmdline_opt = 5, play_opt = 6;

// C ref: hack.h nh_getenv() -> getenv().  Node exposes the process
// environment; a browser has none, so there every name reads as unset (NULL).
function nh_getenv(name) {
    const env = (typeof process !== 'undefined' && process && process.env) || null;
    if (!env) return null;
    const v = env[name];
    return v === undefined ? null : v;
}

// C ref: <stdlib.h> atoi() — leading integer, 0 when there is none.
function atoi(s) {
    const n = parseInt(String(s ?? ''), 10);
    return Number.isNaN(n) ? 0 : n;
}

// C ref: <stdlib.h> strtol(s, NULL, 0) — base 0 accepts "dddd" as decimal
// provided the first 'd' is not '0', "0xhhhh" as hex and "0ooo" as octal, and
// ignores trailing junk (including '8'/'9' after a leading '0').
function strtol_base0(s) {
    const str = String(s ?? '');
    let i = 0;
    while (i < str.length && ' \t\n\v\f\r'.includes(str[i])) i++;
    let sign = 1;
    if (str[i] === '+' || str[i] === '-') { if (str[i] === '-') sign = -1; i++; }
    let base = 10, digits = '0123456789';
    if (str[i] === '0') {
        if (str[i + 1] === 'x' || str[i + 1] === 'X') {
            base = 16; digits = '0123456789abcdef'; i += 2;
        } else {
            base = 8; digits = '01234567'; i += 1;
        }
    }
    let val = 0, any = (base === 8); /* the leading '0' is itself a digit */
    for (; i < str.length; i++) {
        const d = digits.indexOf(str[i].toLowerCase());
        if (d < 0) break;
        val = val * base + d;
        any = true;
    }
    return any ? sign * val : 0;
}

// C ref: sys/unix/unixunix.c:466 file_exists() — access(path, F_OK) against the
// REAL filesystem, which this port has no access to (js/storage.js's VFS only
// holds save/bones files).  Returning TRUE reproduces what C did in every
// recording: sysconf's GDBPATH and GREPPATH both named binaries that were
// present, so cnf_line_GDBPATH/GREPPATH took their no-error path.  This is not
// a general filesystem check and must not be used as one.
function file_exists(_path) {
    return true;
}

// C ref: sys/unix/unixmain.c:681 append_slash().
function append_slash(name) {
    if (!name) return name;
    return name.endsWith('/') ? name : name + '/';
}

// ---------------------------------------------------------------------------
// State cfgfiles.c owns.

// C ref: cfgfiles.c:124 `static const char *default_configfile` — the UNIX arm.
const default_configfile = '.nethackrc';
// C ref: cfgfiles.c:136 `static char configfile[BUFSZ]`.
let configfile = '';
// C ref: cfgfiles.c:112.
let ignore_errors_on_unmatched = false, ignore_statement_errors = false;

// C ref: decl.h iflags.parse_config_file_src, set by read_config_file() and
// read back by cnf_line_SEDUCE().  Held here rather than on a fake iflags
// object because js/ has no port of that struct.
let parse_config_file_src = set_in_config;
// C ref: decl.h:729 go.opt_phase.
let opt_phase = phase_not_set;
// C ref: decl.c gc.cmdline_rcfile — the `--nethackrc=` argument, which
// sys/unix/unixmain.c fills in and rcfile() consumes and frees.
let cmdline_rcfile = null;
// C ref: decl.c gf.fqn_prefix[] — only NOCWD_ASSUMPTIONS builds write it.
const fqn_prefix = [];

// C ref: include/sys.h:8 struct sysopt_s.  The instance lives in C's decl.c and
// its defaults are installed by sys.c:21 sys_early_init(); sys.c has no port,
// so the object and those defaults live here, next to the only code that writes
// them.  Move it when sys.c is ported.
//
// The values below are sys_early_init()'s result for THIS build, which is
// SYSCF + UNIX/MACOS + CRASHREPORT-implied PANICTRACE, no DUMPLOG, and
// NH_DEVEL_STATUS == NH_STATUS_RELEASED (patchlevel.h:33).  Each one that comes
// from a compile-time macro names it.
export const sysopt = {
    support: null,
    recover: null,
    wizards: null,              /* SYSCF: NULL, not WIZARD_NAME; sysconf sets it */
    fmtd_wizard_list: null,
    explorers: null,
    shellers: null,
    genericusers: null,
    debugfiles: null,           /* SYSCF and no getenv("DEBUGFILES") */
    msghandler: null,
    dumplogfile: null,          /* #ifdef DUMPLOG — off (config.h:669) */
    env_dbgfl: 0,
    maxplayers: 0,
    seduce: 1,                  /* compiled in, so default on */
    check_save_uid: 1,
    check_plname: 0,
    bones_pools: 0,
    livelog: LL_NONE,
    persmax: 3,                 /* max(PERSMAX, 1),   PERSMAX 3    config.h:333 */
    pers_is_uid: 1,             /* PERS_IS_UID 1 for !MICRO/!MACOS9/!WIN32:343 */
    entrymax: 100,              /* max(ENTRYMAX, 10), ENTRYMAX 100 config.h:339 */
    pointsmin: 1,               /* max(POINTSMIN, 1), POINTSMIN 1  config.h:336 */
    tt_oname_maxrank: 10,
    gdbpath: '/usr/bin/gdb',    /* GDBPATH  config.h:238 */
    greppath: '/bin/grep',      /* GREPPATH config.h:241 */
    crashreporturl: null,
    panictrace_gdb: 0,          /* NH_STATUS_RELEASED, so 0 rather than 1 */
    panictrace_libc: 0,         /* NH_STATUS_RELEASED, so 0 rather than 2 */
    saveformat: [1, 0],         /* historical = 1, hack.h:976 */
    bonesformat: [1, 0],
    accessibility: 0,
    portable_device_paths: 0,   /* #ifdef WIN32 */
    hideusage: 0,
};

// C ref: decl.c gc.config_section_chosen / gc.config_section_current, which
// free_config_sections() releases.  js/options.js handle_config_section() reads
// the same pair off a state object as {section_chosen, section_current}, so
// that is the shape here.
const config_sections = { section_chosen: null, section_current: null };

// ---------------------------------------------------------------------------
// C ref: cfgfiles.c:138-152.

export function get_configfile() {
    return configfile;
}

export function get_default_configfile() {
    return default_configfile;
}

// C ref: cfgfiles.c:167 do_write_config_file() — the #saveoptions command.
// Two of its steps have no port: options.c all_options_strbuf() (which
// serialises the whole option set) and an exported paranoid_query() —
// js/eat.js and js/extcmd-handlers.js each define one but neither exports it.
// So this reaches the prompt and stops; it is left in C's shape for whoever
// ports those.
export function do_write_config_file() {
    /* The steps, in C's order, and why each one stops here:
       1. !configfile[0] -> pline("Strange, could not figure out config file
          name.") and return.  js/display.js exports pline(), but it is async
          and this whole command is unreachable until step 3 exists.
       2. flags.suppress_alert < FEATURE_NOTICE_VER(3,7,0) -> three warnings
          ("saveoptions is highly experimental!", "Some settings are not
          saved!", "All manual customization and comments are removed from the
          file!"), each followed by wait_synch().  flags.suppress_alert has no
          shared home in js/ (js/options.js keeps it per-parse on `result`),
          and options.js's wait_synch() only records into the rc-parse raw
          stream, so it is NOT the in-game getret() C calls here.
       3. Sprintf(tmp, "Overwrite config file %.*s?", BUFSZ - 28 - 2,
          configfile) then paranoid_query(TRUE, tmp).  js/eat.js and
          js/extcmd-handlers.js each define paranoid_query() but neither
          exports one.
       4. fopen(configfile, "w"), all_options_strbuf(&buf) — no port at all —
          fwrite, fclose, and a "wrote only partial data (%zu/%zu)." pline if
          the write came up short.  The write itself is
          vfsWriteFile(configfile, buf). */
    unported('options.c all_options_strbuf() / an exported paranoid_query()');
    return ECMD_OK;
}

// C ref: cfgfiles.c:215 set_configfile_name() — strncpy into a BUFSZ buffer,
// so the name is truncated to BUFSZ-1 characters.
export function set_configfile_name(fname) {
    configfile = String(fname ?? '').slice(0, BUFSZ - 1);
}

// C ref: cfgfiles.c:222 fopen_config_file().  This build is UNIX + __APPLE__
// and not MICRO/MACOS9/__BEOS__/WIN32/VMS, so the arms below are that path:
// sysconf, then a caller-supplied name (with '~/' expansion and an
// access()-denied complaint), then $HOME/.nethackrc, then the two
// Library/Preferences alternates.
//
// C's `FILE *` becomes a cursor over the file's whole contents, because
// parse_conf_buf() depends on fgets()' exact framing.  The bytes come from
// js/storage.js's VFS; a real filesystem is not reachable from the port, so
// errno is not either and the final "Couldn't open default config file"
// branch (which C takes only when errno != ENOENT) is unreachable here.
function nh_fopen_read(path) {
    const text = vfsReadFile(path);
    return text === null ? null : { text, pos: 0 };
}

// C ref: <stdio.h> fgets() — up to size-1 bytes, stopping after a '\n' which
// is kept; NULL at end of file.
function fgets(fp, size) {
    if (!fp || fp.pos >= fp.text.length) return null;
    let out = '';
    while (fp.pos < fp.text.length && out.length < size - 1) {
        const c = fp.text[fp.pos++];
        out += c;
        if (c === '\n') break;
    }
    return out;
}

export function fopen_config_file(filename, src) {
    let fp;
    let tmp_config, envp;

    if (src === set_in_sysconf) {
        /* SYSCF_FILE; if we can't open it, caller will bail */
        if (filename) {
            /* C: fqname(filename, SYSCONFPREFIX, 0); without
               NOCWD_ASSUMPTIONS every prefix is "", so the name is itself */
            set_configfile_name(filename);
            fp = nh_fopen_read(configfile);
        } else {
            fp = null;
        }
        return fp;
    }
    /* If src != set_in_sysconf, "filename" is an environment variable, so it
       should hang around.  If set, it is expected to be a full path name. */
    if (filename) {
        set_configfile_name(filename);
        if (configfile.startsWith('~/') && (envp = nh_getenv('HOME')) !== null) {
            /* support for '--nethackrc=~/path' (or NETHACKOPTIONS='@~/path';
               '~user/path' is not supported) */
            tmp_config = `${envp}/${configfile.slice(2)}`;
            set_configfile_name(tmp_config);
        }
        if (vfsReadFile(configfile) === null) { /* C: access(configfile, 4) == -1 */
            /* nasty sneaky attempt to read a file through NetHack's setuid
               permissions -- this is the only place a file name may be wholly
               under the player's control */
            /* PLACEHOLDER: the trailing number is C's errno, which this
               port has no model for.  Both of these messages are screen
               content, so the 0 has to become a real value before either is
               wired up. */
            raw_print(`Access to ${configfile} denied (0).`);
            wait_synch();
            /* fall through to standard names */
        } else if ((fp = nh_fopen_read(configfile)) !== null) {
            return fp;
        } else {
            /* access() above probably caught most problems for UNIX */
            raw_print(`Couldn't open requested config file ${configfile} (0).`);
            wait_synch();
        }
    }
    /* fall through to standard names */
    envp = nh_getenv('HOME');
    tmp_config = (envp === null) ? '.nethackrc' : `${envp}/.nethackrc`;
    set_configfile_name(tmp_config);
    if ((fp = nh_fopen_read(configfile)) !== null)
        return fp;
    /* __APPLE__: try the OSX-style names, then put configfile[] back to the
       preferred value rather than leaving it on the last alternate */
    if (envp !== null) {
        let alt_config = `${envp}/Library/Preferences/NetHack Defaults`;
        set_configfile_name(alt_config);
        if ((fp = nh_fopen_read(configfile)) !== null)
            return fp;
        /* may be easier to edit if the name has a '.txt' suffix */
        alt_config = `${envp}/Library/Preferences/NetHack Defaults.txt`;
        set_configfile_name(alt_config);
        if ((fp = nh_fopen_read(configfile)) !== null)
            return fp;
        set_configfile_name(tmp_config);
        if ((fp = nh_fopen_read(configfile)) !== null)
            return fp;
    }
    /* C's `if (errno != ENOENT) raw_printf("Couldn't open default config
       file ...")` cannot be reached: the VFS reports "absent" and "refused"
       the same way. */
    return null;
}

// C ref: cfgfiles.c:427 adjust_prefix() — #ifdef NOCWD_ASSUMPTIONS, which this
// build does not define, so none of the *DIR statements reach it.
export function adjust_prefix(bufp, prefixid) {
    if (bufp === null || bufp === undefined)
        return;
    /* Backward compatibility, ignore trailing ;n */
    const semi = bufp.indexOf(';');
    if (semi >= 0) bufp = bufp.slice(0, semi);
    if (bufp.length > 0)
        fqn_prefix[prefixid] = append_slash(bufp);
}

// C ref: cfgfiles.c:452 choose_random_part() — pick one of the sep-separated
// parts of str at random.  C mangles str in place and returns a pointer into
// it; JS strings are immutable, so the chosen part comes back as a slice.
//
// The rn2(nsep) here is C's FIRST draw of the game when the rc file has a
// CHOOSE line, which is why js/options.js does not take it (see the file
// header).
export function choose_random_part(str, sep) {
    let nsep = 1;
    let csep;
    let len = 0;
    let begin = 0;

    if (str === null || str === undefined)
        return null;

    let i = 0;
    while (i < str.length) {
        if (str[i] === sep) nsep++;
        i++;
    }
    csep = rn2(nsep);
    i = begin;
    while (csep > 0 && i < str.length) {
        i++;
        if (str[i] === sep) csep--;
    }
    if (i < str.length) {
        if (str[i] === sep) i++;
        begin = i;
        while (i < str.length && str[i] !== sep) { i++; len++; }
        if (len) return str.slice(begin, begin + len);
    }
    return null;
}

// C ref: cfgfiles.c:493 free_config_sections().
export function free_config_sections() {
    config_sections.section_chosen = null;
    config_sections.section_current = null;
}

// ---------------------------------------------------------------------------
// #ifdef SYSCF — cfgfiles.c:783..1140.  SYSCF is defined in this build
// (config.h:233) and SYSCF_FILE is "sysconf" (config.h:234).  Each of these
// runs only while parse_config_line() has iflags.parse_config_file_src ==
// set_in_sysconf, which is why js/options.js's CONFIG_LINE_STMT leaves them
// out: a player rc naming one of them is an "Unknown config statement" either
// way.

// C ref: cfgfiles.c:786.  The formatted list is built up front because it is
// displayed during a panic, and that panic may be an out-of-memory one.
export function cnf_line_WIZARDS(bufp) {
    sysopt.wizards = String(bufp ?? '');
    if (sysopt.wizards.length && sysopt.wizards !== '*') {
        /* NOT PORTED: end.c:1823 build_english_list(), which turns "a b c"
           into "a, b, or c".  Its only consumer is panic(), which has no port
           either, so the pre-formatted list stays empty rather than wrong. */
        sysopt.fmtd_wizard_list = null;
    }
    return true;
}

export function cnf_line_SHELLERS(bufp) {
    sysopt.shellers = String(bufp ?? '');
    return true;
}

export function cnf_line_MSGHANDLER(bufp) {
    sysopt.msghandler = String(bufp ?? '');
    return true;
}

export function cnf_line_EXPLORERS(bufp) {
    sysopt.explorers = String(bufp ?? '');
    return true;
}

// C ref: cfgfiles.c:834.  A value from getenv("DEBUGFILES") wins over sysconf.
export function cnf_line_DEBUGFILES(bufp) {
    if (!sysopt.env_dbgfl)
        sysopt.debugfiles = String(bufp ?? '');
    return true;
}

// C ref: cfgfiles.c:846 — #ifdef DUMPLOG, which this build leaves off
// (config.h:669), so C's arm is `nhUse(bufp)` and the statement is a no-op
// that still counts as matched.
export function cnf_line_DUMPLOGFILE(bufp) {
    sysopt.dumplogfile = String(bufp ?? '');
    return true;
}

export function cnf_line_GENERICUSERS(bufp) {
    sysopt.genericusers = String(bufp ?? '');
    return true;
}

// C ref: cfgfiles.c:868.  The cap of 10 keeps (N % bones.pools) to one digit
// so bones file names cannot grow.
export function cnf_line_BONES_POOLS(bufp) {
    const n = atoi(bufp);

    sysopt.bones_pools = (n <= 0) ? 0 : Math.min(n, 10);
    return true;
}

export function cnf_line_SUPPORT(bufp) {
    sysopt.support = String(bufp ?? '');
    return true;
}

export function cnf_line_RECOVER(bufp) {
    sysopt.recover = String(bufp ?? '');
    return true;
}

export function cnf_line_CHECK_SAVE_UID(bufp) {
    const n = atoi(bufp);

    sysopt.check_save_uid = n;
    return true;
}

export function cnf_line_CHECK_PLNAME(bufp) {
    const n = atoi(bufp);

    sysopt.check_plname = n;
    return true;
}

// C ref: cfgfiles.c:911.  Anyone may turn it off; only sysconf may turn it on,
// and a user rc asking for it when sysconf already disabled it is an error.
export function cnf_line_SEDUCE(bufp) {
    let n = atoi(bufp) ? 1 : 0;
    const src = parse_config_file_src;
    const in_sysconf = (src === set_in_sysconf);

    if (!in_sysconf && !sysopt.seduce && n !== 0) {
        config_error_add('Illegal value in SEDUCE');
        n = 0;
    }
    sysopt.seduce = n;
    /* C calls sysopt_seduce_set(sysopt.seduce), which is a no-op in this
       build: sys.c:164 wraps its whole body in `#if 0` because attack
       substitution now happens on the fly in getmattk(). */
    return true;
}

export function cnf_line_HIDEUSAGE(bufp) {
    const n = atoi(bufp) ? 1 : 0;

    sysopt.hideusage = n;
    return true;
}

// C ref: cfgfiles.c:941.  More than 25 would need the lock code rewritten.
export function cnf_line_MAXPLAYERS(bufp) {
    let n = atoi(bufp);

    if (n < 0 || n > 25) {
        config_error_add('Illegal value in MAXPLAYERS (maximum is 25)');
        n = 5;
    }
    sysopt.maxplayers = n;
    return true;
}

// C ref: cfgfiles.c:954.  Note the asymmetry with the message: the floor is 1
// but the replacement value is 0.
export function cnf_line_PERSMAX(bufp) {
    let n = atoi(bufp);

    if (n < 1) {
        config_error_add('Illegal value in PERSMAX (minimum is 1)');
        n = 0;
    }
    sysopt.persmax = n;
    return true;
}

export function cnf_line_PERS_IS_UID(bufp) {
    let n = atoi(bufp);

    if (n !== 0 && n !== 1) {
        config_error_add('Illegal value in PERS_IS_UID (must be 0 or 1)');
        n = 0;
    }
    sysopt.pers_is_uid = n;
    return true;
}

export function cnf_line_ENTRYMAX(bufp) {
    let n = atoi(bufp);

    if (n < 10) {
        config_error_add('Illegal value in ENTRYMAX (minimum is 10)');
        n = 10;
    }
    sysopt.entrymax = n;
    return true;
}

export function cnf_line_POINTSMIN(bufp) {
    let n = atoi(bufp);

    if (n < 1) {
        config_error_add('Illegal value in POINTSMIN (minimum is 1)');
        n = 100;
    }
    sysopt.pointsmin = n;
    return true;
}

export function cnf_line_MAX_STATUENAME_RANK(bufp) {
    let n = atoi(bufp);

    if (n < 1) {
        config_error_add('Illegal value in MAX_STATUENAME_RANK'
                         + ' (minimum is 1)');
        n = 10;
    }
    sysopt.tt_oname_maxrank = n;
    return true;
}

// C ref: cfgfiles.c:1034.  strtol() with base 0, and note the FALSE return
// (C writes `return 0`) on an out-of-range value — every other range check in
// this family substitutes a default and returns TRUE.
export function cnf_line_LIVELOG(bufp) {
    const L = strtol_base0(bufp);

    if (L < 0 || L > 0xffff) {
        config_error_add('Illegal value for LIVELOG'
                         + ' (must be between 0 and 0xFFFF).');
        return false;
    }
    sysopt.livelog = L;
    return true;
}

// C ref: cfgfiles.c:1050.  PANICTRACE and PANICTRACE_LIBC are both defined in
// this build (config.h:272 defines PANICTRACE from CRASHREPORT on MACOS,
// global.h:451 defines PANICTRACE_LIBC on MACOS), so the range check is live.
export function cnf_line_PANICTRACE_LIBC(bufp) {
    let n = atoi(bufp);

    if (n < 0 || n > 2) {
        config_error_add('Illegal value in PANICTRACE_LIBC (not 0,1,2)');
        n = 0;
    }
    sysopt.panictrace_libc = n;
    return true;
}

export function cnf_line_PANICTRACE_GDB(bufp) {
    let n = atoi(bufp);

    if (n < 0 || n > 2) {
        config_error_add('Illegal value in PANICTRACE_GDB (not 0,1,2)');
        n = 0;
    }
    sysopt.panictrace_gdb = n;
    return true;
}

// C ref: cfgfiles.c:1078.  #if defined(PANICTRACE) && !defined(VMS) holds
// here, so the existence check runs.
export function cnf_line_GDBPATH(bufp) {
    if (!file_exists(bufp)) {
        config_error_add('File specified in GDBPATH does not exist');
        return false;
    }
    sysopt.gdbpath = String(bufp ?? '');
    return true;
}

export function cnf_line_GREPPATH(bufp) {
    if (!file_exists(bufp)) {
        config_error_add('File specified in GREPPATH does not exist');
        return false;
    }
    sysopt.greppath = String(bufp ?? '');
    return true;
}

export function cnf_line_CRASHREPORTURL(bufp) {
    sysopt.crashreporturl = String(bufp ?? '');
    return true;
}

export function cnf_line_ACCESSIBILITY(bufp) {
    let n = atoi(bufp);

    if (n < 0 || n > 1) {
        config_error_add('Illegal value in ACCESSIBILITY (not 0,1)');
        n = 0;
    }
    sysopt.accessibility = n;
    return true;
}

// C ref: cfgfiles.c:1129.  Windows-only directive; on every other platform the
// value is discarded and the statement itself is reported as an error — but it
// still returns TRUE.
export function cnf_line_PORTABLE_DEVICE_PATHS(bufp) {
    config_error_add('PORTABLE_DEVICE_PATHS is not supported');
    return true;
}

// ---------------------------------------------------------------------------
// #ifdef USER_SOUNDS — cfgfiles.c:1206/1215 and can_read_file().  This build
// does NOT define USER_SOUNDS, so C has no SOUNDDIR/SOUND rows in
// config_line_stmt[] at all and such a line is an "Unknown config statement".
// Translated for completeness; do not add them to a dispatch table without
// turning USER_SOUNDS on.

// C ref: sounds.c `char *sounddir`.
export let sounddir = null;

export function cnf_line_SOUNDDIR(bufp) {
    sounddir = String(bufp ?? '');
    return true;
}

export function cnf_line_SOUND(bufp) {
    unported('sounds.c:1556 add_sound_mapping()');
    return true;
}

// C ref: cfgfiles.c:1442 can_read_file() — access(filename, 4).
export function can_read_file(filename) {
    return vfsReadFile(filename) !== null;
}

// ---------------------------------------------------------------------------
// C ref: cfgfiles.c:1291 config_line_stmt[] — the CNFL_S (syscnf_only) rows,
// [name, minimum match length, handler].  js/options.js's CONFIG_LINE_STMT
// holds the CNFL_N rows; these are the ones it drops.  Kept as data so the
// lengths can be checked against the C table directly.
export const CONFIG_LINE_STMT_SYSCF = [
    ['WIZARDS', 7, cnf_line_WIZARDS],
    ['SHELLERS', 8, cnf_line_SHELLERS],
    ['MSGHANDLER', 9, cnf_line_MSGHANDLER],
    ['EXPLORERS', 7, cnf_line_EXPLORERS],
    ['DEBUGFILES', 5, cnf_line_DEBUGFILES],
    ['DUMPLOGFILE', 7, cnf_line_DUMPLOGFILE],
    ['GENERICUSERS', 12, cnf_line_GENERICUSERS],
    ['BONES_POOLS', 10, cnf_line_BONES_POOLS],
    ['SUPPORT', 7, cnf_line_SUPPORT],
    ['RECOVER', 7, cnf_line_RECOVER],
    ['CHECK_SAVE_UID', 14, cnf_line_CHECK_SAVE_UID],
    ['CHECK_PLNAME', 12, cnf_line_CHECK_PLNAME],
    ['SEDUCE', 6, cnf_line_SEDUCE],
    ['HIDEUSAGE', 9, cnf_line_HIDEUSAGE],
    ['MAXPLAYERS', 10, cnf_line_MAXPLAYERS],
    ['PERSMAX', 7, cnf_line_PERSMAX],
    ['PERS_IS_UID', 11, cnf_line_PERS_IS_UID],
    ['ENTRYMAX', 8, cnf_line_ENTRYMAX],
    ['POINTSMIN', 9, cnf_line_POINTSMIN],
    ['MAX_STATUENAME_RANK', 10, cnf_line_MAX_STATUENAME_RANK],
    ['LIVELOG', 7, cnf_line_LIVELOG],
    ['PANICTRACE_LIBC', 15, cnf_line_PANICTRACE_LIBC],
    ['PANICTRACE_GDB', 14, cnf_line_PANICTRACE_GDB],
    ['CRASHREPORTURL', 13, cnf_line_CRASHREPORTURL],
    ['GDBPATH', 7, cnf_line_GDBPATH],
    ['GREPPATH', 7, cnf_line_GREPPATH],
    ['ACCESSIBILITY', 13, cnf_line_ACCESSIBILITY],
    ['PORTABLE_DEVICE_PATHS', 8, cnf_line_PORTABLE_DEVICE_PATHS],
];

// C ref: cfgfiles.c:1385 `static boolean
// disregarded_config_lines[SIZE(config_line_stmt)]`, indexed by
// config_line_stmt[] position.  CAVEAT for whoever wires the heed/disregard
// switches up: C's index space includes the 28 syscnf_only rows above, and
// js/options.js's CONFIG_LINE_STMT omits them, so a C statement index does not
// address the same row on this side.
const disregarded_config_lines = new Array(CONFIG_LINE_STMT.length).fill(false);

// C ref: cfgfiles.c:1966..1990.
export function heed_all_config_statements() {
    for (let i = 0; i < disregarded_config_lines.length; i++)
        disregarded_config_lines[i] = false;
}

export function disregard_all_config_statements() {
    for (let i = 0; i < disregarded_config_lines.length; i++)
        disregarded_config_lines[i] = true;
}

export function heed_this_config_statement(statement_idx) {
    if (statement_idx >= 0 && statement_idx < disregarded_config_lines.length)
        disregarded_config_lines[statement_idx] = false;
}

export function disregard_this_config_statement(statement_idx) {
    if (statement_idx >= 0 && statement_idx < disregarded_config_lines.length)
        disregarded_config_lines[statement_idx] = true;
}

// C ref: cfgfiles.c:1994..2005.
export function clear_ignore_errors_on_unmatched() {
    ignore_errors_on_unmatched = false;
}

export function set_ignore_errors_on_unmatched() {
    ignore_errors_on_unmatched = true;
}

export function config_unmatched_ignored() {
    if (ignore_errors_on_unmatched)
        return true;
    return false;
}

// ---------------------------------------------------------------------------
// C ref: cfgfiles.c:1477 struct _config_error_errmsg — the list config_erradd()
// builds while iflags.in_lua is set, drained by l_get_config_errors().  That
// in_lua branch is NOT PORTED (js/options.js config_error_add() has no lua
// path), so the list here never fills and the drain always returns empty.
let config_error_msg = null;

// C ref: cfgfiles.c:1509 l_get_config_errors() — builds a lua table of
// {line, error} pairs and frees the list.  There is no lua_State on this side,
// so the table itself is the return value.
export function l_get_config_errors() {
    let dat = config_error_msg;
    const out = [];

    while (dat) {
        out.push({ line: dat.line_num, error: dat.errormsg });
        dat = dat.next;
    }
    config_error_msg = null;

    return out;
}

// NOT PORTED here, deliberately: config_erradd() and vconfig_error_add() are
// already ported, folded together into js/options.js config_error_add() (which
// its own comment cites as "C ref: cfgfiles.c config_erradd()").  A second copy
// would shadow the live one.  What that port still lacks, for the record: the
// !program_state.config_error_ready early path, the iflags.in_lua branch that
// feeds config_error_msg above, the `secure` frame flag (so "Error:" vs " *"),
// and vconfig_error_add()'s truncation of the formatted message to BUFSZ-1.

// C ref: cfgfiles.c:1614 read_config_file().  The extra `result` argument is
// this port's option accumulator: js/options.js parse_config_line() writes
// into it instead of into C's globals, so `proc` has to close over it.
export function read_config_file(filename, src, result) {
    const fp = fopen_config_file(filename, src);
    if (!fp)
        return false;
    /* begin detection of duplicate configfile options */
    reset_duplicate_opt_detection();
    free_config_sections();
    parse_config_file_src = src;

    /* js/options.js parse_config_line() is void where C's returns boolean: it
       reports every failure through config_error_add() rather than to its
       caller, so this wrapper always succeeds and parser.rv ends up tracking
       only the parser's own errors. */
    const rv = parse_conf_file(fp, (buf) => { parse_config_line(buf, result); return true; });
    /* C: fclose(fp) */

    free_config_sections();
    /* turn off detection of duplicate configfile options */
    reset_duplicate_opt_detection();
    return rv;
}

// C ref: cfgfiles.c:1638 struct _cnf_parser_state / :1650 cnf_parser_init().
export function cnf_parser_init(parser) {
    parser.rv = true; /* assume successful parse */
    parser.ep = parser.buf = null;
    parser.skip = false;
    parser.morelines = false;
    parser.inbufsz = 4 * BUFSZ;
    parser.inbuf = '';
    parser.cont = false;
    parser.pbreak = false;
}

// C ref: cfgfiles.c:1666 cnf_parser_done() — 'rv' is left intact for the
// caller.
export function cnf_parser_done(parser) {
    parser.ep = 0; /* points into parser->inbuf, so becoming stale */
    parser.inbuf = null;
    parser.buf = null;
}

// C ref: cfgfiles.c:1685 parse_conf_buf() — one physical line of the config,
// handling comments, empty lines, sections, CHOOSE and '\'-continuation, and
// calling proc for every complete logical line.  Continued lines are merged
// with one space between them.
//
// C walks parser->inbuf with a moving char* and writes '\0' into it; here `ep`
// is that index and `line` is inbuf as those writes leave it.  ep < 0 stands
// for a NULL pointer, which matters: C's `if (p->ep)` after the too-long
// branch must NOT fire, while an ep of 0 from eos() on an empty buffer must.
//
// SECOND COPY WARNING: js/options.js parseNethackrc() inlines this same loop
// and is what runs today.  Keep them in step, and delete that one when this is
// wired up.
export function parse_conf_buf(p, proc) {
    p.cont = false;
    p.pbreak = false;
    const nl = p.inbuf.indexOf('\n');
    let ep = nl;
    let epIsNull = (nl < 0);
    if (p.skip) { /* in case previous line was too long */
        if (!epIsNull)
            p.skip = false; /* found newline; next line is normal */
        return;
    }
    let line;
    if (epIsNull) { /* newline missing */
        if (p.inbuf.length < p.inbufsz - 2) {
            /* likely the last line of file is just missing a newline;
               process it anyway */
            ep = p.inbuf.length; /* eos(p->inbuf) */
            epIsNull = false;
        } else {
            config_error_add('Line too long, skipping');
            p.skip = true; /* discard next fgets */
        }
    }
    if (epIsNull)
        return;
    line = p.inbuf.slice(0, ep); /* *p->ep = '\0' — remove newline */

    /* line continuation (trailing '\') */
    ep--;
    p.morelines = (ep >= 0 && line[ep] === '\\');
    if (p.morelines)
        line = line.slice(0, ep);

    /* trim off spaces at end of line */
    while (ep >= 0
           && (line[ep] === ' ' || line[ep] === '\t' || line[ep] === '\r')) {
        line = line.slice(0, ep);
        ep--;
    }

    config_error_nextline(line);
    /* NOT PORTED: C aborts the whole parse here when config_error_nextline()
       returns FALSE (`p->rv = FALSE; free(p->buf); p->pbreak = TRUE`), which
       happens only for a `secure` frame that has already logged an error.
       js/options.js config_error_init() carries no `secure` flag and its
       config_error_nextline() is void, so that branch is unreachable. */

    ep = 0; /* p->ep = p->inbuf */
    while (line[ep] === ' ' || line[ep] === '\t')
        ++ep;
    const epStr = line.slice(ep);

    /* ignore empty lines and full-line comment lines */
    const ignoreline = (!epStr || epStr[0] === '#');
    const oldline = (p.buf !== null);

    /* merge the line just read with previous ones, if necessary */
    if (!ignoreline) {
        p.buf = (p.buf !== null) ? (p.buf + ' ' + epStr) : epStr;
        if (p.buf.length >= p.inbufsz)
            p.buf = p.buf.slice(0, p.inbufsz - 1);
    }

    if (p.morelines || (ignoreline && !oldline))
        return;

    if (handle_config_section(p.buf, config_sections)) {
        p.buf = null;
        return;
    }

    /* from here onwards, we'll handle buf only */

    if (match_optname(p.buf, 'CHOOSE', 6, true)) { /* match_varname() */
        let section;
        const sep = find_optparam(p.buf);

        if (sep < 0) {
            config_error_add('Format is CHOOSE=section1,section2,...');
            p.rv = false;
            p.buf = null;
            return;
        }
        const bufp = p.buf.slice(sep + 1);
        config_sections.section_chosen = null;
        section = choose_random_part(bufp, ',');
        if (section !== null) {
            config_sections.section_chosen = section;
        } else {
            config_error_add('No config section to choose');
            p.rv = false;
        }
        p.buf = null;
        return;
    }

    if (!proc(p.buf))
        p.rv = false;

    p.buf = null;
}

// C ref: cfgfiles.c:1808 parse_conf_str() — feed a string through
// parse_conf_buf() one fgets()-sized chunk at a time.
export function parse_conf_str(str, proc) {
    const parser = {};

    cnf_parser_init(parser);
    free_config_sections();
    config_error_init('parse_conf_str');
    let s = 0;
    while (str && s < str.length) {
        let len = 0;
        let chunk = '';
        while (s < str.length && len < parser.inbufsz - 1) {
            chunk += str[s];
            len++;
            s++;
            if (chunk[len - 1] === '\n')
                break;
        }
        parser.inbuf = chunk;
        parse_conf_buf(parser, proc);
        if (parser.pbreak)
            break;
    }
    cnf_parser_done(parser);

    free_config_sections();
    config_error_done();
    return parser.rv;
}

// C ref: cfgfiles.c:1840 parse_conf_file() — read from fp, calling
// parse_conf_buf() for each line.
export function parse_conf_file(fp, proc) {
    const parser = {};

    cnf_parser_init(parser);
    free_config_sections();

    let ln;
    while ((ln = fgets(fp, parser.inbufsz)) !== null) {
        parser.inbuf = ln;
        parse_conf_buf(parser, proc);
        if (parser.pbreak)
            break;
    }
    cnf_parser_done(parser);

    free_config_sections();
    return parser.rv;
}

// C ref: cfgfiles.c:1886 rcfile() — resolve which config file to read from
// NETHACKOPTIONS / HACKOPTIONS / --nethackrc, read it, then apply any
// NETHACKOPTIONS that was an option list rather than a file name.
//
// The extra `result` argument is this port's option accumulator (see
// read_config_file()).
export function rcfile(result) {
    let opts = null, xtraopts = null;
    let envname, namesrc, nameval;

    opt_phase = environ_opt;
    /* getenv() instead of nhgetenv(): let the total length of options be long;
       parseoptions() will check each individually */
    envname = 'NETHACKOPTIONS';
    opts = nh_getenv(envname);
    if (!opts) {
        /* fall back to the original name; discouraged */
        envname = 'HACKOPTIONS';
        opts = nh_getenv(envname);
    }

    if (cmdline_rcfile) {
        namesrc = 'command line';
        nameval = cmdline_rcfile;
        xtraopts = opts;
        if (opts && (opts[0] === '/' || opts[0] === '\\' || opts[0] === '@'))
            xtraopts = null; /* NETHACKOPTIONS is a file name; ignore it */
    } else if (opts && (opts[0] === '/' || opts[0] === '\\' || opts[0] === '@')) {
        /* NETHACKOPTIONS is a file name; use that instead of the default */
        if (opts[0] === '@')
            opts = opts.slice(1); /* @filename */
        namesrc = envname;
        nameval = opts;
        xtraopts = null;
    } else {
        /* either no NETHACKOPTIONS or it wasn't a file name; read the default
           configuration file */
        nameval = namesrc = null;
        xtraopts = opts;
    }

    opt_phase = rc_file_opt;
    /* the seemingly arbitrary name length restriction keeps error messages,
       if any are delivered while accessing the file, from overflowing
       buffers */
    if (nameval && nameval.length >= BUFSZ / 2) {
        config_error_init(namesrc);
        config_error_add(
            `nethackrc file name "${nameval.slice(0, 40)}"... too long;`
            + ' using default');
        config_error_done();
        nameval = namesrc = null; /* revert to the default nethackrc */
    }

    /* C: config_error_init(TRUE, nameval, nameval ? CONFIG_ERROR_SECURE
       : FALSE) — js/options.js's port takes the source name only. */
    config_error_init(nameval);
    read_config_file(nameval, set_in_config, result);
    config_error_done();
    if (xtraopts) {
        /* NETHACKOPTIONS is present and not a file name */
        opt_phase = environ_opt;
        config_error_init(envname);
        parseoptions(xtraopts, true, result);
        config_error_done();
    }

    if (cmdline_rcfile)
        cmdline_rcfile = null;
    /* [end of nethackrc handling] */
}

// C ref: cfgfiles.c:1943 rcfile_interface_options() — a first pass over the rc
// that heeds ONLY windowtype and soundlib, so the window port is chosen before
// anything else is parsed.  Every options.c switch it needs is unported:
// allopt_array_init(), disregard_all_options(), heed_this_option(),
// heed_all_options(), disregard_this_option(), and the opt_windowtype /
// opt_soundlib indices.
export function rcfile_interface_options(result) {
    unported('options.c allopt_array_init()');
    unported('options.c disregard_all_options()');
    disregard_all_config_statements();
    unported('options.c heed_this_option(opt_windowtype)');
    unported('options.c heed_this_option(opt_soundlib)');
    set_ignore_errors_on_unmatched();
    ignore_statement_errors = true;
    rcfile(result);
    heed_all_config_statements();
    unported('options.c heed_all_options()');
    unported('options.c disregard_this_option(opt_windowtype)');
    unported('options.c disregard_this_option(opt_soundlib)');
    clear_ignore_errors_on_unmatched();
    ignore_statement_errors = false;
}

// C ref: cfgfiles.c:2013 assure_syscf_file() — #ifdef SYSCF && SYSCF_FILE, both
// on in this build.  C open()s SYSCF_FILE read-only and, if it cannot, prints
// and exit(EXIT_FAILURE)s; there is no exit here, so it throws.
export function assure_syscf_file() {
    if (vfsReadFile(SYSCF_FILE) !== null) {
        /* readable */
        return;
    }
    /* NOT PORTED: C first checks gd.deferred_showpaths and hands off to
       do_deferred_showpaths(1), which does not return. */
    raw_print('Unable to open SYSCF_FILE.\n');
    throw new Error('Unable to open SYSCF_FILE.');
}

/* cfgfiles.c */
