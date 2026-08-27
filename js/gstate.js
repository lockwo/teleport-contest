// gstate.js — Global game state reference.
// All game modules import `game` from here.

export let game = {};

export function resetGame() {
    game = {};
    return game;
}

// Late-bound entry points for modules that cannot be `import`ed from their
// caller without reordering ESM evaluation.  js/light.js registers
// `lightsources` here; js/vision.js calls it from vision_recalc().  Unlike
// `game`, this object survives resetGame().
export const hooks = { lightsources: null };
