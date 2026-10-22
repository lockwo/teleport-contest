// gstate.js — Global game state reference.
// All game modules import `game` from here.

export let game = {};

export function resetGame() {
    game = {};
    return game;
}

// C ref: a freshly exec'd NetHack process starts every file-scope `static` and
// every decl.c global that save.c never writes (mthrowu.c do_not_annoy, shk.c
// pickmovetime, uhitm.c clockwise, ...) at its compiled-in value.  The judge
// runs every segment of a session in ONE node process (frozen/ps_test_runner.mjs
// runSession -> runSegment), so a module-level `let` that mirrors such a static
// would carry the previous segment's value across a save/restore (or into the
// next game).  A module registers a resetter here and NethackGame.start() runs
// them all, right after resetGame(), exactly where a new process would begin.
const process_statics = [];
export function register_process_static(reset) { process_statics.push(reset); }
export function reset_process_statics() { for (const reset of process_statics) reset(); }

// C ref: svc.context.run.  This port splits C's one variable three ways:
// context.run (the live run/travel), context.run_leftover8 (the run == 8 a
// finished travel leaves behind, see hack.js travel_walk()) and
// context.stale_run (the 2/3 a g/G prefix leaves behind across a
// bad_command, see cmd.js rhack()).  C tests of svc.context.run read this.
export function svc_context_run() {
    const c = game.context;
    if (!c) return 0;
    return c.run || (c.run_leftover8 ? 8 : 0) || c.stale_run || c.cmd_stale_run || 0;
}

// Late-bound entry points for modules that cannot be `import`ed from their
// caller without reordering ESM evaluation.  js/light.js registers
// `lightsources` here; js/vision.js calls it from vision_recalc().  js/invent.js
// registers `merged` for js/mkobj.js container insertion.  Unlike `game`, this
// object survives resetGame().
export const hooks = { lightsources: null, merged: null, noticeQueue: null, flushNotices: null };
