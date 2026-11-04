# constcheck

`node scripts/constcheck/constcheck.mjs` extracts every identifier-named numeric constant initialised with a literal or constant expression anywhere in `js/` (acorn), and has clang check `_Static_assert(NAME == jsvalue)` and `_Static_assert(NAME == <js initializer as C>)` against `nethack-c/recorder/include`. Output: MISMATCH lines, ALIAS-MISMATCH (JS names decorated with `_OTYP`/`P_`). Known benign: role/race-index `PM_*`, terminal `ATR_*` bit layout, `NHKF_*` key chars, `TIP_GETPOS` as `1 << tip`.
