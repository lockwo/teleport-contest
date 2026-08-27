# Differential State Oracle (`scripts/oracle.mjs`)

Pinpoints the **first input-boundary where our JS port's game state diverges
from the recorded C game state**, with full provenance (step#, rng-call#,
entity, field, C-value vs JS-value, and the C rng-callsite around that
boundary). Drives the parallel porting campaign: one glance tells you which
C function to fix.

## Quick start

```sh
# one-session "fix-this" report (first divergence)
node scripts/oracle.mjs seed4500-knight-coverage

# campaign map across ALL 44 sessions / segments
node scripts/oracle.mjs --summary

# machine-readable
node scripts/oracle.mjs seed4500-knight-coverage --json
node scripts/oracle.mjs --summary --json

# skip a known/in-progress divergence class to surface the NEXT one
node scripts/oracle.mjs seed4500-knight-coverage --ignore pm,PRESENT
node scripts/oracle.mjs seed4500-knight-coverage --from 263
node scripts/oracle.mjs --summary --ignore pm,PRESENT
```

Session arg accepts a bare name (`seed4500-knight-coverage`), a filename
(`...session.json`), or a path.

## What it compares

Three sources, all firing at the SAME per-keystroke input boundaries, aligned
1:1 by step index (with a front-anchor on first-hero-placed to absorb chargen
prompt-count differences):

| source | role |
|---|---|
| `sessions/<name>.session.json` | canonical C recording — **authoritative** for rng# + callsites (byte-exact) |
| `/private/tmp/gt/seed<N>.state.jsonl` | C per-boundary STATE dump (full fmon chain + hero hp/multi), from the NHGT recorder |
| our JS port (`runSegment` with `NHJSDUMP=1`, `getStateDumps()`) | the port under test |

Per boundary it compares **hero** (`ux uy uhp uhpmax multi`) and **every
monster keyed by m_id** (species `name`, `mx my mhp mhpmax`, disposition
`mtame mpeaceful`, status `mflee mfleetim mfrozen msleeping mcanmove`, and the
numeric `pmidx`), plus chain membership (a monster present in one fmon and not
the other) and `nmon`.

## Reading the report

- **`✓ C-recorder rng# matches canonical`** — the C state.jsonl is byte-exact;
  trust it fully. (A `⚠ rng-validity horizon: step N` instead means the C
  recorder drifted at step N — only trust state.jsonl before there.)
- **`step` / `C-rng#` / `JS-rng#`** — the boundary, and the rng_call_count
  there on each side. **If C-rng# == JS-rng# but state differs → a
  state-tracking bug (the RNG stream is aligned).** If they differ → the RNG
  stream itself diverged (over/under-draw).
- **`MON <species>#<m_id> . <field> : C=… JS=…`** — exactly which entity and
  field, with both values.
- **C/JS rng-log at step N** — the C callsites (`fn(file:line)`) vs our JS
  rng-log entries for that step.
- **`➜ FIX`** — the C function / structural site to port.

`--summary` adds a **cause** column: `state` (rng aligned, state field wrong)
vs `RNG` (rng stream diverged), and a totals line.

## Regenerating the C ground truth

The state.jsonl files come from the NHGT-instrumented recorder. To (re)record:

```sh
# ensure the recorder install dir has a sysconf WITHOUT `GENERICUSERS=*`
# (that flag forces the "Who are you?" name prompt and breaks recording).
printf 'WIZARDS=*\nEXPLORERS=*\nMAXPLAYERS=10\nSUPPORT=\n' \
  > nethack-c/recorder/install/games/lib/nethackdir/sysconf

NHGT=1 node scripts/record-session.mjs sessions/<name>.session.json /dev/null
```

`make install` wipes the sysconf, so recreate it after any recorder rebuild.

## Zero-overhead guarantee

The JS dumper (`NethackGame._captureStateDump`, gated on `process.env.NHJSDUMP`)
is a complete no-op when `NHJSDUMP` is unset — verified: screen and rng output
are byte-identical with and without it, so the judge run is unaffected.
