# FIX 2 — Generic game-start rendering (the big screen unlock)

## TL;DR of the whole strategic finding
The contest scores **screens** (per-step 24×80 grid match). RNG parity is only a
prerequisite. The swarm has been grinding RNG parity (`screens +0` commits) but the
real bottleneck is **chargen / game-start RENDERING**, not RNG.

`js/allmain.js newgame()` is still the seed8000 **skeleton stub**: it calls the
`fastforward_*` RNG-replay helpers and then **hardcodes** `urole = Tourist`, Tourist
attributes `[9,14,12,11,16,16]`, `uhp=10 uen=2 uac=10 gold=757`, `female=true`,
align `neutral` (allmain.js lines ~54-68), and plines a hardcoded
`"Aloha <name>, welcome to NetHack! You are a neutral female human Tourist."`.

So **every** session renders a Tourist game-start regardless of its real role. That is
why ~30 sessions score 0 screens even when their RNG matches deep into the game.

## Already fixed this session (committed, baseline now 86 screens)
- jsmain.js `_startupCharacterSelection`: always prompt "Who are you?" when no `name:`
  in rc (even if role/race/align pinned). +8.
- jsmain.js yn-prompt cursor: `Shall I pick...? [ynaq]` cursor at col 74 (len+1). +8.

## The target: rewrite newgame() to render the REAL role's game-start, generically.

### "RIPE" sessions — full newgame RNG parity, 0 screens ONLY because of the Tourist hardcode
These will score immediately once the real role/attrs/HP/Pw/AC/legend/welcome render:
- `seed0383-wizard-hallucinate`  (0/219)  legacy ON  → step0 = legend + status
- `seed2600-wizard-custom-binds` (0/38)   legacy ON  → step0 = legend + status
- `seed2200-wizard-quaff-zap-read` (0/230) legacy ON → step0 = legend + status
- `seed4500-knight-coverage`     (0/1814) legacy OFF → step0 = welcome + MAP + status

`u_init.js u_init_inventory_attrs()` already implements **real** chargen attrs+inventory
for **Wizard (PM_WIZARD=12)** and **Knight (PM_KNIGHT=4)** only (see ROLE_ATTRS,
ROLE_INVENTORY). For wizard/knight, `fastforward_post_mklev()` already calls the real
`u_init_inventory_attrs()`; newgame then THROWS AWAY the result. So for these roles FIX 2
is mostly a *rendering/wiring* fix, not new RNG.

### MUST NOT regress
- `seed8000-tourist-starter` (16/23) — Tourist, legacy OFF. Its fastforward path does NOT
  run real u_init (uses hardcoded RNG + the Tourist hardcode). Keep it working: e.g. only
  apply the real-state path for roles whose real u_init ran (wizard/knight), and keep the
  Tourist hardcode as the fallback for the fastforward/Tourist path.
- The 9 "category-A" sessions that currently score 6-9 (0002,0004,0006,0007,0009,0012,
  0014,0017,0077) — these are interactive-chargen sessions; their early screens already
  match. Don't break them.

## Tools
- Full score: `node frozen/ps_test_runner.mjs sessions/` → stderr per-session
  `FAIL: seedX (RNG a/b, Screen c/d)`, stdout after `__RESULTS_JSON__` is a JSON bundle.
- One session: `node frozen/ps_test_runner.mjs sessions/seed0383-wizard-hallucinate.session.json`
- **Per-step grid diff** (your main loop): `node swarm/state/dbg-screens.mjs <session.json> <N>`
  prints, for the first N steps, whether cells/cursor match and the JS vs C 24×80 grids
  with the first differing cell. Use this on seed0383 to converge pixel-exact.
- `SESSION_REPLAY_TIMEOUT_MS=60000` env if a session times out.

## Exact step-0 targets (regenerate full text with: `node -e "console.log(require('./sessions/seed0383-wizard-hallucinate.session.json').segments[0].steps[0].screen)"`)

### seed0383 (wizard, neutral, legacy ON) — cursor [31,17,1]
Rows 0-16 = centered legend (col 23; the indented "Moloch" block at col 27),
row 17 = `--More--` (col 23, cursor at col 31), rows 18-21 blank, rows 22-23 = status:
```
Wizard the Evoker             St:12 Dx:14 Co:12 In:15 Wi:12 Ch:10 Neutral
Dlvl:1 $:0 HP:12(12) Pw:8(8) AC:0 Xp:1
```
Note: name shows "Wizard" (debug mode forces plname="wizard"); no `/exp` and no `T:1`
because rc has neither `showexp` nor `time`. `St:12 Dx:14 Co:12 In:15 Wi:12 Ch:10` is the
real wizard attribute roll (acurr order is [Str,Int,Wis,Dex,Con,Cha]).

### seed4500 (knight, lawful, legacy OFF, debug) — cursor [8,1,1]
Row 0 = `Salutations wizard, welcome to NetHack!  You are a lawful male human Knight.`
Row 1 = `--More--` (cursor [8,1]); the small fountain starting room is drawn at the right
(cols ~73-79, DEC line-drawing) over rows 12-17; status rows 22-23:
```
Wizard the Gallant   St:18/01 Dx:9 Co:12 In:7 Wi:14 Ch:17 Lawful
Dlvl:1 $:0 HP:16(16) Pw:3(3) AC:3 Xp:1/0 T:1
```
4500 has `showexp,time` → shows `Xp:1/0 T:1`. St:18/01 = exceptional strength
(STR18(01)); the knight attr roll can exceed 18 → "18/NN" formatting.

## The legend ("legacy" common quest text — C `com_pager("legacy")`, allmain.c:832)
Template (from `nethack-c/upstream/dat/quest.lua`, the `legacy` entry):
```
It is written in the Book of %d:

    After the Creation, the cruel god Moloch rebelled
    against the authority of Marduk the Creator.
    Moloch stole from Marduk the most powerful of all
    the artifacts of the gods, the Amulet of Yendor,
    and he hid it in the dark cavities of Gehennom, the
    Under World, where he now lurks, and bides his time.

Your %G %d seeks to possess the Amulet, and with it
to gain deserved ascendance over the other gods.

You, a newly trained %r, have been heralded
from birth as the instrument of %d.  You are destined
to recover the Amulet for your deity, or die in the
attempt.  Your hour of destiny has come.  For the sake
of us all:  Go bravely with %d!
```
Substitutions (see `nethack-c/upstream/src/questpgr.c` for the full %-code table):
- `%d` = deity name. `roles[].gods` is `[lawfulGod, neutralGod, chaoticGod]`.
  alignIndex: lawful→0, neutral→1, chaotic→2. Wizard neutral → gods[1]="Thoth".
  Knight lawful → gods[0]="Lugh".
- `%G` = "god" or "goddess" (deity's gender). Default "god"; the goddess set is in
  questpgr.c — handle generally if easy, else "god" covers the canaries.
- `%r` = rank title = `roles[].rank[0].m` (or `.f` when female and `.f` defined).
  Wizard rank[0]="Evoker", Knight="Gallant".

Centered tty TEXT window (matches recorded `\x1b[23C` indentation):
`offx = max(10, 79 - maxLineLen)` where `maxLineLen` = length of the LONGEST rendered line
(including its leading spaces). The longest line "    Under World, where he now lurks, and
bides his time." is 56 chars and deity-independent → offx=23 for most roles (Samurai's long
deity "Amaterasu Omikami" makes a deity-bearing line longer → smaller offx, which is correct).
Each line is drawn starting at column `offx` (so the 4-space Moloch block lands at offx+4).
`--More--` (inverse video) is on the row immediately after the last template line, at column
`offx`; cursor parked at `[offx+8, thatRow]`.

Render approach: draw directly to the terminal grid (like jsmain.js `_renderStartupScreen`
draws the chargen screens), then `await nhgetch()` so jsmain's `game._preNhgetchHook`
capture hook fires and records this as a step. The status line (rows 22-23) must already be
on the grid underneath (draw the normal frame first, then overlay the legend window region).

## Status line (js/display.js `_statusLine1` / `_statusLine2`)
Already reads game state. Fixes needed:
- plname: if `playmode:debug` (parse from rc; options.js), force plname="wizard".
- statusLine2: append `/<uexp>` after `Xp:<ulevel>` ONLY if `showexp` option set; append
  ` T:<moves>` ONLY if `time` option set. (0383 has neither; 4500 has both.)
- HP/Pw/AC must be real (below). Status1 gap logic (col 31 align) is already correct.
- Strength formatting: STR>18 shows `18/NN` (e.g. 18/01). Port the str display (attrib.c
  `acurrstr`/the status formatting) for the knight case.

## HP / Pw (C: u_init.c:996-997 in `u_init_misc`, pre-mklev; newhp() attrib.c:1080, newpw() exper.c:45)
Level-0:
- `uhp = uhpmax = urole.hpadv.infix + urace.hpadv.infix + (urole.hpadv.inrnd?rnd(inrnd):0) + (urace.hpadv.inrnd?rnd(inrnd):0)` (no Con adj at level 0).
- `uen = uenmax = urole.enadv.infix + urace.enadv.infix + (urole.enadv.inrnd?rnd(inrnd):0) + (urace.enadv.inrnd?rnd(inrnd):0)`.
Role advance structs `{infix,inrnd,lofix,lornd,hifix,hirnd}` (from role.c):
- Knight  hp `{14,0,0,8,2,0}` en `{1,4,0,1,0,2}`  → HP=14+2=16; Pw=1+1+rnd(4)=2+rnd(4) (4500: rnd(4)=1 → Pw 3)
- Wizard  hp `{10,0,0,8,1,0}` en `{4,3,0,2,0,3}`  → HP=10+2=12; Pw=4+1+rnd(3)=5+rnd(3) (0383: rnd(3)=3 → Pw 8)
- human race hp `{2,0,0,2,1,0}` en `{1,0,2,0,2,0}` → adds 2 HP, 1 Pw, no rnd.
The `rnd(inrnd)` for Pw is ALREADY emitted by `fastforward.js fastforward_newpw()` (wizard
rnd(3), knight rnd(4)) and discarded. Replace that with a real newpw that STORES uen/uenmax,
keeping the exact same RNG call at the same position. newhp has inrnd=0 for wizard/knight →
no rnd. Do NOT change the overall RNG sequence (RIPE sessions must stay RNG-correct).

## AC (C: do_wear.c:2470 find_ac)
`uac = mons[u.umonnum].ac - sum ARM_BONUS(worn armor)` where worn = uarm,uarmc,uarmh,uarmf,
uarms,uarmg,uarmu (+ ring of protection, etc., not relevant at start). `ARM_BONUS(obj) =
objects[otyp].a_ac + obj.spe - (material/erosion adj, 0 at start)`. Base `mons[player].ac`
is the player-monster AC (read `nethack-c/upstream/src/monst.c` / its included data; player
roles like PM_WIZARD/PM_KNIGHT have specific base AC). Wizard AC must come out 0, Knight 3.
You must wire `ini_inv` (u_init.js) to actually `setworn` the starting armor with the right
W_ARM* masks (set game.uarm/uarmc/uarmh/uarms/uarmg) and port find_ac + ARM_BONUS + the
object a_ac data for the starting armor pieces (ring mail, helmet, small shield, leather
gloves for Knight; cloak of magic resistance for Wizard). Verify against the recorded AC.

## welcome(TRUE) (C: allmain.c:880-916) — shown AFTER the legend's --More-- (and is step-0 for legacy-OFF sessions like 4500)
`pline("%s %s, welcome to NetHack!  You are a%s.", Hello(), plname, buf)` where buf builds
` <align> [<gender>] <race> <role>`:
- gender word included only if role has no fixed female name AND role allows both M+F.
- `Hello()` (role.c:2119): Knight "Salutations", Samurai "Konnichi wa", Tourist "Aloha",
  Valkyrie "Velkommen", else "Hello" (Wizard → "Hello").
For 4500 (debug → plname "wizard"): `Salutations wizard, welcome to NetHack!  You are a lawful male human Knight.`

## Output / acceptance
- Run the full scorer. Total screens MUST be ≥ 86 and **no session may drop** below its
  current count. Confirm the RIPE wizard sessions (0383/2600/2200) now score their step-0
  (and ideally a few more), and seed8000 still 16.
- Keep edits faithful to C structure (one js file per c file; function names mirror C).
  Do NOT touch frozen files (js/isaac64.js, js/terminal.js, js/storage.js).
