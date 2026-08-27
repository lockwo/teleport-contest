// monmr_data.js — GENERATED, do not hand-edit.
// Source: nethack-c/recorder/include/monsters.h (the C build that produced the
// recorded sessions), via swarm/bin/gen-monmr.mjs.
//
// permonst.mr — each monster's BASE MAGIC RESISTANCE PERCENTAGE, the 4th field of
// the LVL(lvl, mov, ac, mr, aln) macro, indexed by the same pmidx js/makemon.js
// uses (the generator refuses to emit unless all 383 indices match that
// table by name).
//
// NOT to be confused with makemon.js's MONS[].mresists, which is the MR_*
// resistance BITMASK: a wraith's mresists is 166 while its mr is 15.
//
// Read by zap.c resist():  rn2(100 + alev - dlev) < mtmp->data->mr
export const MON_MR = [
    0, 0, 0, 10, 0, 0, 0, 0, 0, 30, 30, 30, 0, 0, 0, 10,
    0, 0, 0, 0, 0, 20, 0, 0, 20, 20, 20, 0, 10, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 25, 0, 0, 0, 10, 0, 10, 20,
    90, 90, 0, 10, 20, 0, 20, 30, 10, 10, 20, 0, 0, 0, 10, 20,
    0, 10, 20, 20, 20, 20, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0,
    0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 10, 20, 20, 0, 0,
    0, 0, 0, 0, 0, 70, 70, 70, 0, 0, 0, 30, 30, 30, 30, 30,
    0, 0, 10, 20, 0, 0, 0, 0, 0, 30, 30, 55, 90, 80, 0, 0,
    0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20,
    20, 20, 20, 20, 20, 20, 20, 20, 20, 0, 30, 30, 30, 30, 0, 0,
    0, 0, 0, 0, 0, 4, 4, 10, 20, 0, 0, 0, 5, 10, 0, 10,
    70, 0, 50, 10, 10, 20, 20, 30, 60, 90, 90, 20, 20, 20, 20, 30,
    30, 30, 30, 0, 0, 0, 0, 0, 10, 70, 50, 0, 30, 60, 0, 0,
    0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 40,
    0, 25, 25, 50, 80, 5, 15, 25, 20, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30,
    40, 50, 50, 60, 0, 10, 10, 20, 2, 10, 10, 10, 20, 25, 20, 50,
    40, 0, 50, 50, 70, 0, 5, 0, 15, 15, 0, 15, 50, 100, 40, 50,
    0, 30, 70, 50, 30, 35, 80, 50, 55, 40, 55, 65, 65, 60, 75, 65,
    80, 85, 75, 80, 85, 90, 95, 100, 100, 100, 127, 30, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 1, 1, 0, 1, 1,
    2, 2, 2, 1, 1, 1, 1, 3, 90, 90, 90, 90, 90, 90, 90, 90,
    90, 90, 90, 90, 90, 75, 10, 30, 0, 20, 10, 85, 0, 30, 40, 50,
    80, 10, 10, 10, 10, 10, 20, 20, 10, 10, 10, 10, 20, 10, 30,
];

// C ref: the permonst.mr field for a MONS record (makemon.js monster_by_pmidx).
export function mon_mr(ptr) {
    return (ptr && ptr.pmidx != null) ? (MON_MR[ptr.pmidx] ?? 0) : 0;
}
