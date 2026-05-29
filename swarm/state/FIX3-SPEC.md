# FIX 3 — Map renderer: objects, monsters, dungeon features, doors

## Context (read swarm/state/FIX2-SPEC.md first for the big picture)
Baseline is now **88** public screens (commit 99a499d). The generic game-start renders
real role/attrs/legend/welcome/status for Wizard/Knight. The next blocker — identified by
all 3 FIX-2 implementers — is the **map renderer**: `js/display.js newsym()` /
`terrain_glyph()` only render TERRAIN (floor, walls, corridor, stairs, doors-as-floor).
They do NOT render: dungeon **features** (fountain, altar, sink, throne, grave),
floor **objects** (`game.level.objects` — populated but never drawn), **monsters**
(incl. the starting pet and level monsters), or **door states** (`+` closed / `|` open).

Because the RIPE sessions (0383/2600/2200 wizard, 4500 knight) have correct level STATE
(RNG-correct through mklev+fill), rendering these glyphs will make their early map screens
match. This is foundational: it converts the swarm's RNG-parity work into screen points.

## Concrete missing glyphs (examples)
- **seed4500-knight-coverage step 0**: starting room cols 73-79; row 14/16 show
  `~~ <SI>:<SO> ~x` where `:` is a **yellow monster** (a newt/lizard, S_LIZARD class) next to
  `@`. The walls/floor/@ already render; the monster `:` (color bright-yellow 93) does not.
  (Also needs the welcome line's `--More--` to wrap to row 1, cursor [8,1] — message pager.)
- **seed0383 / seed2600 step 1** (welcome + --More-- over the map): the starting room has a
  closed **door** `+`, the **pet** `f` (kitten), and possibly a **fountain**; none render.
- **seed2200-wizard step 0**: starting room is on the LEFT (cols <22, outside the legend
  menu's clear region) and shows through; needs object `(` (weapon on floor), interior wall
  segments, etc. First diff: r11 c16 JS floor vs C `x` (vwall) + a `(` object at c18.

## What to port (C ref: src/display.c map_glyphinfo/show_glyph + back_to_glyph; src/drawing.c
##   def_oc_syms (object class symbols), def_monsyms (monster class symbols), defsyms (cmap))
Extend the JS map render so each visible cell shows the top of the glyph stack, NetHack
priority **monster > object > trap > dungeon-feature > door > terrain**:
1. **Dungeon features** in `terrain_glyph()` (js/display.js): add typ FOUNTAIN(28)→`{`,
   THRONE(29)→`\`, SINK(30)→`#`, GRAVE(31)→`|`, ALTAR(32)→`_`, plus any others the targets
   need, with the correct symset (DECgraphics) char + color. VERIFY each char/color against
   the recorded screens — do NOT guess; the recorder used `symset:DECgraphics`.
2. **Door states**: closed/locked door `+` (brown), open door `|`/`-` (brown) — currently
   the DOOR case only handles open/closed-as-`+`/nodoor-as-floor; confirm colors vs C.
3. **Floor objects**: iterate `game.level.objects` (see js/mkobj.js:980 — objects pushed with
   ox/oy and oclass). Render each at (ox,oy) with the object-class symbol (def_oc_syms:
   weapon `)`, armor `[`, ring `=`, amulet `"`, tool `(`, food `%`, potion `!`, scroll `?`,
   spellbook `+`, wand `/`, gold `$`, gem `*`, rock `` ` ``, ball `0`, chain `_`, venom `.`)
   and the object's color. Only when the cell is in sight / remembered (memory rules below).
4. **Monsters**: find how monsters are stored (NOT in level.monsters — likely a per-cell
   `loc.monst` or a global list/`m_at`; the starting pet comes from `dog.js makedog`, level
   monsters from `makemon`). Render the monster-class letter (def_monsyms: e.g. S_LIZARD `:`,
   dog/kitten `f`, etc.) with the monster's color. Monsters are top priority.
5. **Memory / visibility**: respect the existing `cansee()` + `remembered_glyph` logic in
   newsym()/docrt() — objects/features are remembered when seen; monsters show only in sight.
   Match how the recorder shows the just-generated starting room (lit room → all visible).

## Storage / data you must locate (read the JS)
- Objects: `game.level.objects` (array; each has ox,oy,oclass,otyp). 4500 has 8.
- Monsters: search js/ for how `m_at`/pet/level monsters are stored (level.monsters was empty
  for 4500 — find the real structure). dog.js makedog creates the pet.
- Colors: object/monster/feature colors come from objects[].oc_color / mons[].mcolor / cmap
  colors. Read drawing.c / objects.c / the JS const tables. The terminal color constants are
  in js/terminal.js (CLR_*). render_map_row already does DEC mode + ANSI color — extend it.
- DEC line-drawing: walls already use DEC (\x0e..\x0f). Object/monster/feature ASCII glyphs
  are NOT DEC — emit them in normal (SI) mode with their color.

## Tools / verification (same as FIX 2)
- Per-step grid diff: `node swarm/state/dbg-screens.mjs sessions/seed4500-knight-coverage.session.json 2`
  (and 0383/2600/2200). Iterate until the map region matches cells + color exactly.
- Full score: `SESSION_REPLAY_TIMEOUT_MS=60000 node frozen/ps_test_runner.mjs sessions/`
  (parse JSON after `__RESULTS_JSON__`). MUST stay ≥88 with NO session below its current
  count. seed8000 must stay 16 (it already renders its terrain map — don't break it; if your
  object/monster rendering changes seed8000's early screens, reconcile against its recording).

## Constraints
- Generic (data-driven from object/monster/feature tables), no per-seed hardcoding.
- Never edit frozen files (js/isaac64.js, js/terminal.js, js/storage.js).
- Faithful to C structure; one js file per c file; mirror C function names.

## When done
Run `git add -A && git commit -m "fix3: map renderer (wip)"` IN YOUR WORKTREE so your changes
are captured on disk (the orchestrator harvests the winning worktree directly). Report in your
structured result: totalScreens, noRegression(bool), regressed(list), per-target screen counts
for seed4500/0383/2600/2200/8000, the list of files you changed, and notes on what renders
correctly vs what's still off (with the first remaining cell-diff per target).
