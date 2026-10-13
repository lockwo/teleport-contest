// monspecial.js -- dependency-free leaf for wizard.c's inventory predicates.
// Sync callers in mon.js/muse.js/makemon.js/dog.js/minion.js need these but cannot
// statically import wizard.js (it pulls teleport.js, whose cycle reorders module
// evaluation).  Otyps are the js/mkobj.js objects[] indices (verified by name).
const AMULET_OF_YENDOR = 213, BELL_OF_OPENING = 263, CANDELABRUM_OF_INVOCATION = 262,
      SPE_BOOK_OF_THE_DEAD = 409;
// artilist.h: the role quest artifacts are one contiguous block.
const ART_ORB_OF_DETECTION = 21, ART_EYE_OF_THE_AETHIOPICA = 33;

// C ref: artifact.c any_quest_artifact(obj) -- a quest artifact of ANY role.
export function any_quest_artifact(obj) {
    const a = obj?.oartifact | 0;
    return a >= ART_ORB_OF_DETECTION && a <= ART_EYE_OF_THE_AETHIOPICA;
}
// C ref: wizard.c:106 mon_has_amulet(mtmp).
export function mon_has_amulet(mtmp) {
    for (const otmp of (mtmp?.minvent || []))
        if (otmp.otyp === AMULET_OF_YENDOR) return true;
    return false;
}
// C ref: wizard.c:117 mon_has_special(mtmp).
export function mon_has_special(mtmp) {
    for (const otmp of (mtmp?.minvent || []))
        if (otmp.otyp === AMULET_OF_YENDOR || any_quest_artifact(otmp)
            || otmp.otyp === BELL_OF_OPENING
            || otmp.otyp === CANDELABRUM_OF_INVOCATION
            || otmp.otyp === SPE_BOOK_OF_THE_DEAD)
            return true;
    return false;
}
