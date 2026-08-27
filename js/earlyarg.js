// earlyarg.js — port of src/earlyarg.c (the command-line arguments xxmain()
// handles BEFORE initoptions() runs).
//
// INERT BY DESIGN.  Nothing in js/ imports this module yet, and none of these
// functions draws RNG.  The existing argv path is untouched: js/cfgfiles.js
// keeps its own `cmdline_rcfile` (cfgfiles.js:144) and js/options.js:6971 notes
// that -showpaths is never passed by the harness.
//
// MEASURED CONTEXT.  The recorder passes `-u <OPTIONS=name: value>` and that
// argument is consumed by process_options() AFTER initoptions(), which is why
// a `NAME=` line in an rc file is inert ([[recorder-passes-u-plname]]).  Under
// UNIX (our build) earlyarg.c's `case 'u'` therefore only ever matches
// "-usage": the plname copy in that case is the
// `#elif defined(WIN32) || defined(MSDOS) || defined(AMIGA)` arm and is
// compiled out.  Wiring this module up must not change that.
//
// BUILD GUARDS.  This is the UNIX build: CHDIR and UNIX are defined; WIN32,
// MSDOS, AMIGA, VMS, CRASHREPORT, MSWIN_GRAPHICS, PANICTRACE, BREADCRUMBS and
// NODUMPENUMS are not.  Every #ifdef below is resolved that way and the arms
// that vanish are named in a comment rather than silently dropped.
//
// C POINTERS.  earlyarg.c passes `int *argc_p, char ***argv_p` around and both
// lopt() and consume_arg() mutate them.  A `char **` is modelled here as
// { arr, off } — the shared string array plus the offset the pointer currently
// holds — and an `int *` as { v }.  `++(*argv_p)` is `++ref.off`;
// `--(*argc_p)` is `--ref.v`.

// Nothing imports this module, so a top-level import here cannot reorder ESM
// evaluation for anyone ([[_mktrap_victim TDZ is real]]); js/gstate.js is the
// state leaf, and the rest is pulled in lazily at the call sites so the shape
// of each borrowed helper is documented where it is used.
import { game } from './gstate.js';

// C ref: include/global.h BUFSZ.
const BUFSZ = 256;

// C ref: decl.c gc.cmdline_rcfile / gc.cmdline_windowsys and
// gd.deferred_showpaths[_dir].  js/cfgfiles.js:144 holds the live
// cmdline_rcfile and js/options.js:6971 the live deferred_showpaths; these are
// this module's own copies until one side exports a setter.
export let cmdline_rcfile = null;
export let cmdline_windowsys = null;
export let deferred_showpaths = false;
export let deferred_showpaths_dir = null;

// C ref: include/hack.h:433 enum earlyarg, with NODUMPENUMS undefined and
// WIN32/CRASHREPORT off — so the enum is dense over these six values.
export const ARG_DEBUG = 0;
export const ARG_VERSION = 1;
export const ARG_SHOWPATHS = 2;
export const ARG_DUMPENUMS = 3;
export const ARG_DUMPGLYPHIDS = 4;
export const ARG_DUMPMONGEN = 5;
export const ARG_DUMPWEIGHTS = 6;

// C ref: earlyarg.c:36 earlyopts[] — { e, name, minlength, valallowed }.
// ARG_WINDOWS and ARG_BIDSHOW rows are WIN32/CRASHREPORT-only and absent here.
const earlyopts = [
    { e: ARG_DEBUG, name: 'debug', minlength: 5, valallowed: true },
    { e: ARG_VERSION, name: 'version', minlength: 4, valallowed: true },
    { e: ARG_SHOWPATHS, name: 'showpaths', minlength: 8, valallowed: false },
    { e: ARG_DUMPENUMS, name: 'dumpenums', minlength: 9, valallowed: false },
    { e: ARG_DUMPGLYPHIDS, name: 'dumpglyphids', minlength: 12, valallowed: false },
    { e: ARG_DUMPMONGEN, name: 'dumpmongen', minlength: 10, valallowed: false },
    { e: ARG_DUMPWEIGHTS, name: 'dumpweights', minlength: 11, valallowed: false },
];

// C ref: earlyarg.c:54 — "note: not 'const'"; lopt() hands this back as a
// non-Null bogus value when an optional-value option has no value.
const ArgVal_novalue = '[nothing]';

// C ref: earlyarg.c:56 enum cmdlinearg.
export const ArgValRequired = 0;
export const ArgValOptional = 1;
export const ArgValDisallowed = 2;
const ArgVal_mask = (1 | 2);
export const ArgNamOneLetter = 4;
const ArgNam_mask = 4;
export const ArgErrSilent = 0;
export const ArgErrComplain = 8;
const ArgErr_mask = 8;

// ── C pointer helpers ───────────────────────────────────────────────────────

// A `char **`: the shared array plus the pointer's current offset.
function argv_ref(argv) {
    return Array.isArray(argv) ? { arr: argv, off: 0 } : argv;
}
// argv[i] through such a pointer.
function av(ref, i) { return ref.arr[ref.off + i]; }
// An `int *`.
function int_ref(n) { return (n && typeof n === 'object') ? n : { v: n }; }

// C's NORETURN termination.  opt_terminate(), opt_usage() and scores_only() do
// not return in C (they call nh_terminate()); throwing is the faithful
// analogue, and it keeps a wired-up early_options() from running on.
export class EarlyTerminate extends Error {
    constructor(status) { super('nh_terminate'); this.status = status; }
}
// C ref: unixmain.c error(...) — print and exit(EXIT_FAILURE).
class EarlyError extends Error {}

// ── the parser ──────────────────────────────────────────────────────────────

// C ref: earlyarg.c:70 lopt() — approximate 'getopt_long()' for one option.
// All the comments refer to "-windowtype" but the code isn't specific to it.
//   arg     command line token; beginning matches 'optname'
//   lflags  cmdlinearg | errorhandling
//   optname option's name; "-windowtype" in the examples
//   origarg 'arg' might have had a dash prefix removed
//   argc_p  argc that can have changes passed to caller  ({ v })
//   argv_p  argv[] ditto                                 ({ arr, off })
export async function lopt(arg, lflags, optname, origarg, argc_p, argv_p) {
    const { config_error_add } = await import('./options.js');
    const argc = argc_p.v;
    const argv = argv_p;
    let p = null;               /* C's `char *p`, held as a value here */
    const nextarg = (argc > 1 && av(argv, 1) && av(argv, 1)[0] !== '-')
        ? av(argv, 1) : null;
    let l;
    const opttype = (lflags & ArgVal_mask);
    const oneletterok = ((lflags & ArgNam_mask) === ArgNamOneLetter),
          complain = ((lflags & ArgErr_mask) === ArgErrComplain);

    // C puts the three error labels INSIDE the `arg[1] != optname[1]` block and
    // jumps into it from below; the closures below are those three labels.
    const loptbail = async () => {
        if (complain) await config_error_add(`Unknown option: ${origarg.slice(0, 60)}`);
        return null;
    };
    const loptnotallowed = async () => {
        if (complain) await config_error_add(`Value not allowed: ${origarg.slice(0, 60)}`);
        return null;
    };
    const loptrequired = async () => {
        if (complain) await config_error_add(`Missing required value: ${origarg.slice(0, 60)}`);
        return null;
    };

    /* first letter must match */
    if (arg[1] !== optname[1])
        return await loptbail();

    let pi = arg.indexOf('=');
    if (pi < 0) pi = arg.indexOf(':');
    if (pi >= 0 && opttype === ArgValDisallowed)
        return await loptnotallowed();

    l = (pi >= 0) ? pi : arg.length;
    if ((l > 2 || oneletterok) && arg.substring(0, l) === optname.substring(0, l)) {
        /* "-windowtype[=foo]" */
        if (pi >= 0)
            p = arg.slice(pi + 1);      /* ++p — past '=' or ':' */
        else if (opttype === ArgValRequired)
            p = '';                     /* eos(arg): "-w[indowtype]" w/o "=foo",
                                         * so take foo from the next element */
        else
            return ArgVal_novalue;
    } else if (oneletterok) {
        /* "-w..." but not "-w[indowtype[=foo]]" */
        if (pi < 0) {
            p = arg.slice(2);           /* past 'w' of "-wfoo" */
            /* the "-w:value" arm is #if 0 in C (callers don't expect it) */
        } else {
            /* "-w...=foo" but not "-w[indowtype]=foo" */
            return await loptbail();
        }
    } else {
        return await loptbail();
    }
    if (p === null || p === '') {
        /* "-w[indowtype]" w/o '='/':'; if there is a next element use it for
           "foo", if not supply a non-Null bogus value */
        if (nextarg
            && (opttype === ArgValRequired || opttype === ArgValOptional)) {
            p = nextarg; --argc_p.v; ++argv_p.off;
        } else if (opttype === ArgValRequired) {
            return await loptrequired();
        } else {
            p = ArgVal_novalue;         /* there is no next element */
        }
    }
    return p;
}

// C ref: earlyarg.c:148 consume_arg(ndx, ac_p, av_p) — move argv[ndx] to the
// end of argv[], then reduce argc to hide it; prevents process_options() from
// seeing it again.  Elements get reordered but all remain intact.
export function consume_arg(ndx, ac_p, av_p) {
    let gone;
    const av = av_p;
    let i;
    const ac = ac_p.v;

    /* "-one -two -three -four" -> "-two -three -four -one" */
    if (ac > 2) {
        gone = av.arr[av.off + ndx];
        for (i = ndx + 1; i < ac; ++i)
            av.arr[av.off + i - 1] = av.arr[av.off + i];
        av.arr[av.off + ac - 1] = gone;
    }
    --ac_p.v;
}

// C ref: earlyarg.c:165 consume_two_args() — consume "-two arg" as a pair, so
// "-two arg -three -four" becomes "-three -four -two arg" rather than the
// "-three -four arg -two" two plain consume_arg() calls would produce.
export function consume_two_args(ndx, ac_p, av_p) {
    consume_arg(ndx, ac_p, av_p);
    ++ac_p.v;              /* bring the final slot back into view */
    consume_arg(ndx, ac_p, av_p);
    --ac_p.v;              /* take away restored slot */
}

// C ref: earlyarg.c:179 early_options(argc_p, argv_p, hackdir_p) — process some
// command line arguments before loading options.
//   argc_p     { v: argc }
//   argv_p     { arr: argv, off: 0 }  (argv[0] is the program name)
//   hackdir_p  { v: hackdir }
export async function early_options(argc_p, argv_p, hackdir_p) {
    const { config_error_init, config_error_done } = await import('./options.js');
    let argv, arg, origarg;
    let argc, oldargc, ndx = 0, consumed = 0;

    /* the ENHANCED_SYMBOLS pre-check for --dumpglyphids: our build defines
       ENHANCED_SYMBOLS (js/glyphs.js ports the utf8 map), so it is kept */
    if (await argcheck(argc_p.v, argv_ref(argv_p.arr), ARG_DUMPGLYPHIDS) === 2)
        opt_terminate();

    await config_error_init(false, 'command line', false);

    /* treat "nethack ?" as a request for usage info */
    if (argc_p.v > 1 && argv_p.arr[1] === '?')
        await opt_usage(hackdir_p.v); /* doesn't return */

    /*
     * Both *argc_p and *argv_p account for the program name as (*argv_p)[0];
     * local argc and argv implicitly discard that (by starting 'ndx' at 1).
     */
    for (ndx = 1; ndx < argc_p.v; ndx += (consumed ? 0 : 1)) {
        consumed = 0;
        argc = int_ref(argc_p.v - ndx);
        argv = { arr: argv_p.arr, off: argv_p.off + ndx };

        arg = origarg = av(argv, 0);
        /* skip any args intended for deferred options */
        if (arg[0] !== '-')
            continue;
        /* allow second dash if arg name is longer than one character */
        if (arg[0] === '-' && arg[1] === '-' && arg[2] !== undefined
            && (arg[3] !== undefined && arg[3] !== '=' && arg[3] !== ':'))
            arg = arg.slice(1);         /* ++arg */

        switch (arg[1]) { /* char after leading dash */
        case 'b':
            /* --bidshow is CRASHREPORT-only; compiled out */
            break;
        case 'd':
            if (await argcheck(argc.v, argv, ARG_DEBUG) === 1) {
                consume_arg(ndx, argc_p, argv_p); consumed = 1;
            } else if (await argcheck(argc.v, argv, ARG_DUMPENUMS) === 2) {
                opt_terminate();
                /*NOTREACHED*/
            } else if (await argcheck(argc.v, argv, ARG_DUMPMONGEN) === 2) {
                opt_terminate();
                /*NOTREACHED*/
            } else if (await argcheck(argc.v, argv, ARG_DUMPWEIGHTS) === 2) {
                opt_terminate();
                /*NOTREACHED*/
            } else {
                /* CHDIR is defined on unix */
                oldargc = argc.v;
                arg = await lopt(arg,
                                 (ArgValRequired | ArgNamOneLetter | ArgErrSilent),
                                 '-directory', origarg, argc, argv);
                if (!arg)
                    throw new EarlyError('Flag -d must be followed by a directory name.');
                if (arg[0] !== 'e') { /* avoid matching -decgraphics or -debug */
                    hackdir_p.v = arg;
                    if (oldargc === argc.v) {
                        consume_arg(ndx, argc_p, argv_p); consumed = 1;
                    } else {
                        consume_two_args(ndx, argc_p, argv_p); consumed = 2;
                    }
                }
            }
            break;
        case 'h':
        case '?':
            if (await lopt(arg, ArgValDisallowed, '-help', origarg, argc, argv)
                || await lopt(arg, ArgValDisallowed | ArgNamOneLetter, '-?',
                              origarg, argc, argv))
                await opt_usage(hackdir_p.v); /* doesn't return */
            break;
        case 'n':
            oldargc = argc.v;
            if (arg === '-no-nethackrc') /* no abbreviation allowed */
                arg = '/dev/null';
            else
                arg = await lopt(arg, (ArgValRequired | ArgErrComplain),
                                 '-nethackrc', origarg, argc, argv);
            if (arg) {
                /* C: gc.cmdline_rcfile = dupstr(arg).  js/cfgfiles.js:144 owns
                   that variable and does not export a setter, so record it
                   here; the wiring fix is to export the setter, not to keep
                   two copies of the value. */
                cmdline_rcfile = arg;
                if (oldargc === argc.v) {
                    consume_arg(ndx, argc_p, argv_p); consumed = 1;
                } else {
                    consume_two_args(ndx, argc_p, argv_p); consumed = 2;
                }
            }
            break;
        case 's':
            if (await argcheck(argc.v, argv, ARG_SHOWPATHS) === 2) {
                deferred_showpaths = true;
                deferred_showpaths_dir = hackdir_p.v;
                await config_error_done();
                return;
            }
            /* check for "-s" request to show scores */
            if (await lopt(arg,
                           ((ArgValDisallowed | ArgErrComplain)
                            /* only accept one-letter if there is just one dash;
                               reject "--s" because prscore() via scores_only()
                               doesn't understand it */
                            | ((origarg[1] !== '-') ? ArgNamOneLetter : 0)),
                           '-scores', origarg, argc, argv)) {
                /* argv[0] currently holds "-scores" or a leading substring of
                   it; prscore() expects that in argv[1], so back the pointer up
                   by one to make that the case */
                await scores_only(argc.v + 1,
                                  { arr: argv.arr, off: argv.off - 1 },
                                  hackdir_p.v);
                /*NOTREACHED*/
            }
            break;
        case 'u':
            /* UNIX: only "-usage" is handled here.  The plname copy is the
               WIN32/MSDOS/AMIGA arm and is compiled out — see the measured note
               at the top of this file. */
            if (await lopt(arg, ArgValDisallowed, '-usage', origarg, argc, argv))
                await opt_usage(hackdir_p.v);
            break;
        case 'v':
            if (await argcheck(argc.v, argv, ARG_VERSION) === 2) {
                opt_terminate();
                /*NOTREACHED*/
            }
            break;
        case 'w': /* windowtype: "-wfoo" or "-w[indowtype]=foo"
                   * or "-w[indowtype]:foo" or "-w[indowtype] foo" */
            arg = await lopt(arg,
                             (ArgValRequired | ArgNamOneLetter | ArgErrComplain),
                             '-windowtype', origarg, argc, argv);
            cmdline_windowsys = arg ? arg : null;
            break;
        /* the 'D' (wizard) and 'X' (discover) cases are
           `#if !defined(UNIX) && !defined(VMS)` and are compiled out */
        default:
            break;
        }
    }
    /* empty or "N errors on command line" */
    await config_error_done();
    return;
}

// C ref: earlyarg.c:365 opt_terminate() — for command-line options that perform
// some immediate action and then terminate without starting play, like
// 'nethack --version' or 'nethack -s Zelda'.
export function opt_terminate() {
    if (!game.program_state) game.program_state = {};
    game.program_state.early_options = 0;
    /* config_error_done() frees memory allocated by config_error_init(); the
       JS port has nothing to free, and awaiting it here would make every
       NORETURN caller async, so the call is folded into the throw below. */
    throw new EarlyTerminate(0 /*EXIT_SUCCESS*/);
    /*NOTREACHED*/
}

// C ref: earlyarg.c:375 opt_usage(hackdir) — chdirx() then show usagehlp.
export async function opt_usage(hackdir) {
    /* CHDIR: chdirx(hackdir, TRUE) — the JS port has no working directory */
    void hackdir;
    /* dlb_init() is a no-op here: js/dlb.js reads from the bundled data */
    const { display_file } = await import('./pager.js');
    const { USAGEHELP } = await import('./pager_data.js');
    await display_file(USAGEHELP);   /* genl_display_file(USAGEHELP, TRUE) */
    opt_terminate();
}

// C ref: earlyarg.c:390 after_opt_showpaths(dir) — show the sysconf file name,
// playground directory, run-time configuration file name, dumplog file name if
// applicable, and some other things.  NORETURN.
export function after_opt_showpaths(dir) {
    /* CHDIR: chdirx(dir, FALSE) */
    void dir;
    opt_terminate();
    /*NOTREACHED*/
}

// C ref: earlyarg.c:405 scores_only(argc, argv, dir) — handle
// "-s <score options> [character-names]"; nethack ends after showing them.
export async function scores_only(argc, argv, dir) {
    const { config_error_done } = await import('./options.js');
    /* do this now rather than waiting for final termination, in case there is
       an error summary coming */
    await config_error_done();

    /* CHDIR: chdirx(dir, FALSE) */
    void dir;
    /* SYSCF: iflags.initoptions_noterminate around initoptions().  The JS port
       runs initoptions() from js/jsmain.js and has no sysconf panictrace, so
       re-running it here would double-apply the rc file; the C reason for the
       call (sysconf options affect whether panictrace is enabled) does not
       apply.  PANICTRACE and MSWIN_GRAPHICS arms are likewise absent. */
    /* UNIX: whoami() sets up the default plname[]; js/options.js already
       resolves plname from -u/OPTIONS=name ([[recorder-passes-u-plname]]). */
    const { prscore } = await import('./topten.js');
    const ref = argv_ref(argv);
    /* prscore() indexes argv[0..argc-1]; hand it a plain array window.  Its
       third parameter is this port's stand-in for the RECORD file contents
       (topten.js:913), which C reads with fopen_datafile(). */
    prscore(argc, ref.arr.slice(ref.off, ref.off + argc), null);

    throw new EarlyTerminate(0); /* nh_terminate — bypasses opt_terminate() */
    /*NOTREACHED*/
}

// C ref: earlyarg.c:449 argcheck(argc, argv, e_arg).  Returns:
//    0 = no match
//    1 = found and skip past this argument
//    2 = found and trigger immediate exit
export async function argcheck(argc, argv, e_arg) {
    const { match_optname, raw_print } = await import('./options.js');
    const ref = argv_ref(argv);
    let i, idx;
    let match = false;
    let userea = null;
    let dashdash = '';

    for (idx = 0; idx < earlyopts.length; idx++) {
        if (earlyopts[idx].e === e_arg)
            break;
    }
    if (idx >= earlyopts.length || argc < 1)
        return 0;

    for (i = 0; i < argc; ++i) {
        const a = av(ref, i);
        if (!a || a[0] !== '-')
            continue;
        if (a[1] === '-') {
            userea = a.slice(2);
            dashdash = '-';
        } else {
            userea = a.slice(1);
        }
        match = match_optname(userea, earlyopts[idx].name,
                              earlyopts[idx].minlength,
                              earlyopts[idx].valallowed);
        if (match)
            break;
    }

    if (match) {
        let ci = userea.indexOf(':');
        if (ci < 0) ci = userea.indexOf('=');
        const extended_opt = (ci >= 0) ? userea.slice(ci) : null;

        switch (e_arg) {
        case ARG_DEBUG:
            if (extended_opt) {
                /* C dupstr()s so debug_fields() may write through the buffer;
                   JS strings are immutable, so the copy is implicit */
                await debug_fields(extended_opt.slice(1));
            }
            return 1;
        case ARG_VERSION: {
            let insert_into_pastebuf = false;

            if (extended_opt) {
                const ext = extended_opt.slice(1);   /* extended_opt++ */
                /* "paste" is deprecated in favour of "copy" */
                if (match_optname(ext, 'paste', 5, false)) {
                    insert_into_pastebuf = true;
                } else if (match_optname(ext, 'copy', 4, false)) {
                    insert_into_pastebuf = true;
                } else if (match_optname(ext, 'dump', 4, false)) {
                    /* version number plus enabled features and sanity values */
                    const { dump_version_info } = await import('./version.js');
                    await dump_version_info();
                    return 2; /* done */
                } else if (!match_optname(ext, 'show', 4, false)) {
                    await raw_print(`-${dashdash}version can only be extended`
                        + ` with -${dashdash}version:copy or :dump or :show.\n`);
                    /* exit after we've reported bad command line argument */
                    return 2;
                }
            }
            const { early_version_info } = await import('./version.js');
            await early_version_info(insert_into_pastebuf);
            return 2;
        }
        case ARG_SHOWPATHS:
            return 2;
        case ARG_DUMPENUMS:
            await dump_enums();
            return 2;
        case ARG_DUMPGLYPHIDS:
            await dump_glyphids();
            return 2;
        case ARG_DUMPMONGEN:
            /* C ref: makemon.c dump_mongen() — UNPORTED in js/ */
            return 2;
        case ARG_DUMPWEIGHTS:
            /* C ref: mkobj.c dump_weights() — UNPORTED in js/ */
            return 2;
        /* ARG_BIDSHOW is CRASHREPORT-only, ARG_WINDOWS is WIN32-only */
        default:
            break;
        }
    }
    return 0;
}

// C ref: earlyarg.c:575 debug_fields(opts) — internal developer controls, not
// player options; documented nowhere but in that comment block:
//   test           - test whether this parser is working
//   ttystatus      - TTY:
//   immediateflips - WIN32 (compiled out here)
//   fuzzer         - enable fuzzer without debugger intervention
export async function debug_fields(opts) {
    const { match_optname } = await import('./options.js');
    let op;
    let negated = false;

    /* C truncates at the first comma and recurses on the remainder, so the
       `while` body can only run once (the truncated head has no comma left) */
    const ci = opts.indexOf(',');
    if (ci >= 0) {
        op = opts.slice(ci + 1);        /* *op++ = 0 */
        opts = opts.slice(0, ci);
        await debug_fields(op);          /* recurse */
    }
    if (opts.length > BUFSZ / 2)
        return;

    /* strip leading and trailing white space */
    opts = opts.replace(/^\s+/, '').replace(/\s+$/, '');

    if (!opts.length) {
        /* empty */
        return;
    }
    while ((opts[0] === '!')
           || opts.slice(0, 2).toLowerCase() === 'no') {
        if (opts[0] === '!')
            opts = opts.slice(1);
        else
            opts = opts.slice(2);
        negated = !negated;
    }
    const dbg = debug_flags();
    if (match_optname(opts, 'test', 4, false))
        dbg.test = !negated;
    /* TTY_GRAPHICS is defined for this build */
    if (match_optname(opts, 'ttystatus', 9, false))
        dbg.ttystatus = !negated;
    /* the "immediateflips" field is WIN32-only and compiled out */
    /* C ref: earlyarg.c:618 — minlength 4 for a six-character name, so
       "-debug:fuzz" also sets it; kept verbatim. */
    if (match_optname(opts, 'fuzzer', 4, false))
        dbg.fuzzerpending = true;
    return;
}

// C ref: include/flag.h iflags.debug — the sub-struct debug_fields() writes.
// js/wizcmds.js:545 reads game.iflags.debug_fuzzer, which is the separate
// runtime state the fuzzer uses once started; fuzzerpending is the request.
function debug_flags() {
    if (!game.iflags) game.iflags = {};
    if (!game.iflags.debug)
        game.iflags.debug = { test: false, ttystatus: false };
    /* C keeps iflags.fuzzerpending outside iflags.debug; both live on the same
       object here so debug_fields() has one place to write. */
    if (game.iflags.fuzzerpending === undefined)
        game.iflags.fuzzerpending = false;
    return { set test(v) { game.iflags.debug.test = v; },
             set ttystatus(v) { game.iflags.debug.ttystatus = v; },
             set fuzzerpending(v) { game.iflags.fuzzerpending = v; } };
}

// C ref: earlyarg.c:705 dump_enums() — `nethack --dumpenums`, a developer dump
// of eleven compile-time enums as C source.  The loop and the per-table
// parameters are ported verbatim; the TABLES themselves are C headers included
// eleven times with different macros, and js/ holds only some of them:
//
//   monsdump[]                  js/glyphs.js:316 monsdump_nm (MODULE-PRIVATE;
//                               export it rather than transcribing a second
//                               copy — it is NUMMONS+5 rows of barewords)
//   objdump[]                   js/mkobj.js OBJECT table column 1 is the
//                               bareword ("SPE_CREATE_FAMILIAR"), also private
//   omdump[], defsym_*_dump[],  no port
//   arti_enum_dump[],
//   mcastu_enum_dump[]
//
// So this runs the real algorithm over whatever tables are reachable and names
// each gap; it does not invent data.
export async function dump_enums() {
    const { raw_print } = await import('./options.js');

    /* C ref: earlyarg.c:754 struct de_params edmp[NUM_ENUM_DUMPS] —
       { title, pfx, unprefixed_count, dumpflgs, szd }.  UNPREFIXED_COUNT is 5
       (NUMMONS, NON_PM, LOW_PM, HIGH_PM, SPECIAL_PM). */
    const UNPREFIXED_COUNT = 5;
    const edmp = [
        { title: 'monnums', pfx: 'PM_', unprefixed_count: UNPREFIXED_COUNT, dumpflgs: 0 },
        { title: 'objects_nums', pfx: '', unprefixed_count: 1, dumpflgs: 0 },
        { title: 'misc_object_nums', pfx: '', unprefixed_count: 1, dumpflgs: 0 },
        { title: 'cmap_symbols', pfx: '', unprefixed_count: 1, dumpflgs: 0 },
        { title: 'mon_syms', pfx: '', unprefixed_count: 1, dumpflgs: 0 },
        { title: 'mon_defchars', pfx: '', unprefixed_count: 1, dumpflgs: 1 },
        { title: 'objclass_defchars', pfx: '', unprefixed_count: 1, dumpflgs: 1 },
        { title: 'objclass_classes', pfx: '', unprefixed_count: 1, dumpflgs: 0 },
        { title: 'objclass_syms', pfx: '', unprefixed_count: 1, dumpflgs: 0 },
        { title: 'artifacts_nums', pfx: '', unprefixed_count: 1, dumpflgs: 0 },
        { title: 'mcast_spells', pfx: 'MCAST_', unprefixed_count: 0, dumpflgs: 0 },
    ];
    /* ed[i] is C's `const struct enum_dump *` — rows of { val, nm }.  null
       marks a table js/ cannot reach (see the header comment). */
    const ed = [null, null, null, null, null, null, null, null, null, null, null];

    let nmprefix;
    let i, j, nmwidth;
    let comment;

    for (i = 0; i < edmp.length; ++i) {
        const tbl = ed[i];
        if (!tbl) {
            /* GAP: no reachable table; say so instead of printing "enum X = {}"
               and having it read as an empty enum */
            await raw_print(`/* enum ${edmp[i].title}: table not available`
                            + ' in this port */');
            continue;
        }
        await raw_print(`enum ${edmp[i].title} = {`);
        const szd = tbl.length;
        for (j = 0; j < szd; ++j) {
            nmprefix = (j >= szd - edmp[i].unprefixed_count) ? '' : edmp[i].pfx;
            nmwidth = 27 - nmprefix.length; /* 27 or 24 */
            if (edmp[i].dumpflgs > 0) {
                const v = tbl[j].val;
                comment = `    /* '${(v >= 32 && v <= 126)
                                     ? String.fromCharCode(v) : ' '}' */`;
            } else {
                comment = '';
            }
            /* C: raw_printf("    %s%*s = %3d,%s", nmprefix, -nmwidth, nm, val,
               comment) — %*s with a negative width is left-justified */
            await raw_print(`    ${nmprefix}${tbl[j].nm.padEnd(nmwidth)}`
                            + ` = ${String(tbl[j].val).padStart(3)},${comment}`);
        }
        await raw_print('};');
        await raw_print('');
    }
    await raw_print('');
}

// C ref: earlyarg.c:805 dump_glyphids() — dump_all_glyphids(stdout).
export async function dump_glyphids() {
    const { dump_all_glyphids } = await import('./glyphs.js');
    return dump_all_glyphids(null /* stdout */);
}
