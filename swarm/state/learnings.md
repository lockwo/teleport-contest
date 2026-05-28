# Swarm learnings (auto-distilled by analyst)

_Last refresh: 2026-05-27T00:00:00Z_

## Headline insights

- The swarm has zero porter completions so far — all sections below are derived solely from the static divergence histogram, not from observed porter behavior.
- 44 sessions fail, and 20 of them (45 %) block at a single call site (`place_level` in `dungeon.c:687`), making it the highest-leverage single target in the queue.

## What works

_No porter runs have cleared the merge gate yet. This section will be populated once the first run completes._

## What doesn't work

_No porter runs have been rejected yet. This section will be populated once the first run completes._

## Per-provider patterns

_No differential data available — journal is empty. Check back after `swarm/bin/run-loop.mjs` has produced at least 5 completed runs._

## Per-target patterns

The histogram below is the only signal available. No porter has attempted any of these sites yet.

| Divergence site | File | Line | Blocked sessions | Example session |
|---|---|---|---|---|
| `place_level` | `dungeon.c` | 687 | 20 | `seed0012-monk-vault-escort.session.json` |
| `role_init` | `role.c` | 2060 | 10 | `seed0108-wizard-extcmd-wishlist.session.json` |
| `pick_role` | `role.c` | 1032 | 4 | `seed0002-healer-reflection-drummer.session.json` |
| `randrole` | `role.c` | 726 | 3 | `seed0106-priest-extcmd-sweep.session.json` |
| `init_dungeon_dungeons` | `dungeon.c` | 1074 | 3 | `seed0373-barbarian-quest-tour.session.json` |
| `pick_align` | `role.c` | 1222 | 2 | `seed0006-wizard-water-demon.session.json` |
| `pick_gend` | `role.c` | 1157 | 1 | `seed0014-dequa-fountain-explore.session.json` |
| `m_move` | `monmove.c` | 1963 | 1 | `seed8000-tourist-starter.session.json` |

Note that `role_init`, `pick_role`, `randrole`, `pick_align`, and `pick_gend` all live in `role.c` and together block **20 sessions** — equal to `place_level` alone. A porter that fixes `role.c` coherently (rather than function-by-function) could unlock a large fraction of failing sessions in one shot.

## Recommended next targets (in order)

1. **Fix `place_level` in `dungeon.c` around line 687** — blocks 20 sessions (45 % of failures), no porter has attempted it, highest single-function ROI.
2. **Fix `role_init` in `role.c` around line 2060** — blocks 10 sessions; shares a file with three other divergence sites (`pick_role`, `randrole`, `pick_align`, `pick_gend`), so understanding this function may cascade fixes across all of them.
3. **Fix the `role.c` cluster (`pick_role` / `randrole` / `pick_align` / `pick_gend`) as a unit** — 10 additional sessions across four functions in the same file; batch them in one porter run rather than four separate ones.
4. **Fix `init_dungeon_dungeons` in `dungeon.c` around line 1074** — blocks 3 sessions; shares a file with `place_level` so a porter already familiar with dungeon layout code is the natural fit.
5. **Fix `pick_gend` in `role.c` line 1157 and `m_move` in `monmove.c` line 1963** — 1 session each; lowest priority until higher-count targets are clear.

## Open questions

- Are the `dungeon.c:687` and `dungeon.c:1074` divergences causally related (i.e. does fixing `place_level` also fix `init_dungeon_dungeons`), or are they independent?
- Does `role_init` call `pick_role` / `randrole` / `pick_align` / `pick_gend`? If so, a single fix to `role_init` may cascade to the sub-functions and unlock all 17 `role.c`-blocked sessions at once.
- What is the RNG divergence rate telling us? Current score shows 25 429 / 792 838 RNG calls matching — is the 3 % match rate a floor caused by early divergence on every seed, or is it evidence that some seeds partially replay correctly past the first divergence?
- Are there seeds that partially pass (e.g. diverge only late in the session)? Identifying "almost-passing" seeds could reveal lower-hanging fruit not visible in the histogram.
- Is there a test harness available to run a single session locally (e.g. `npm test -- --seed seed0012`) to allow a porter to iterate quickly before submitting a diff?
