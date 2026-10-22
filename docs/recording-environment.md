# The recording environment

Every session is a recording of NetHack 5.0 running in one specific
environment. Some of what NetHack printed came from that environment
rather than from the game: a file path, a timezone, a terminal type.
To match the recorded screens, your port has to print the same
strings. Hard-coding them is fine. This page lists the environment
the recorder ran in.

## Filesystem

`HOME` was set to the recording harness's working directory:

    /Users/davidbau/git/mazesofmenace/teleport/maud/test/comparison/c-harness/results

Before each launch, the harness wrote the session's `nethackrc` field
to `$HOME/.nethackrc`. NetHack therefore reports its config file as

    /Users/davidbau/git/mazesofmenace/teleport/maud/test/comparison/c-harness/results/.nethackrc

and prints that path wherever it mentions the config file location,
such as the options help pager. The terminal wraps it at column 80,
and the wrap point depends on the string's exact length, so print it
verbatim.

## Terminal

`TERM` was `xterm-256color`, so NetHack believed it had a
256-color terminal. This enables color behavior (for example, symset
wall colors) that a plainer terminal type would turn off.

The screen is 80 columns by 24 rows. Scoring compares the escape
stream your port emits after rendering it into that grid.

## Clock and timezone

`TZ` was `America/New_York`. Moon phase, Friday the 13th, and
day-of-year calculations all used that zone.

Each session's `datetime` field pins the wall clock at launch. The
recorder patches in `nethack-c/patches/` show how.

## Everything else

The recorder build is defined by `nethack-c/build-recorder.sh` and
the patches next to it. It was compiled on macOS, so where behavior
depends on the C library (regex compilation, printf corner cases,
tty input modes), the recordings reflect the Darwin libc.

If a screen seems to depend on something not listed here, open an
issue. Confirmed additions go on this page.

## Targeted read billing recordings

With the optional local `swarm/` tooling installed, preload
`scripts/read-billing-scenarios.mjs` to register faithful C recorder recipes.
Run from a worktree so the later comparison uses that worktree's JS:

```sh
NODE_OPTIONS="--import=$PWD/scripts/read-billing-scenarios.mjs" \
  node swarm/bin/gen.mjs --kind=scen --count=6 --name=read-billing \
  --roles=Wizard --conc=1 \
  --recipes=read-billing-armor-enchant,read-billing-armor-proof,read-billing-destroy-proof,read-billing-weapon-proof,read-billing-water-uncurse,read-billing-water-confused
node swarm/bin/ci.mjs --corpus=heldout-read-billing --out=/tmp/read-billing-results.json
```

`gen.mjs` allocates the seeds and records through the faithful recorder. Check
the generator log before treating a session as proof. A recipe can stop early
when it cannot find a suitable shop or item. The confused-water recipe searches
for naturally stocked water because shops refuse to buy plain water.

These scenarios cover `read.c` billing at mutation boundaries:

- Armor enchantment raises the unpaid item's bill after the enchantment.
  Disenchantment bills a copy of the original item before changing it.
- Removing erosion-proofing through confused enchant armor, destroy armor, or
  enchant weapon restores the original proofing flag while billing, then
  applies the new flag.
- Remove curse bills unpaid unholy water before uncursing it. A confused read
  reprices unpaid water after blessing or cursing it.

The `potion.c H2Opotion_dip` path has a different ordering in the pinned C
source. Its price adjustment precedes the blessing or curse mutation.
Preserve that ordering rather than making it match the confused scroll path.
