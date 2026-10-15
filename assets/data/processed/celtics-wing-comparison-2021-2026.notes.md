# Celtics wing comparison data

`celtics-wing-comparison-2021-2026.csv` contains 15 regular-season
player-season records: Jaylen Brown, Jayson Tatum and Paul George for 2021-22
through 2025-26. It is generated from the nine player-specific files in
`assets/data/raw/`, which are preserved unchanged.

The explicit filename-to-player mapping lives in
`scripts/prepare_celtics_wing_comparison.py`. The script filters non-season
rows, repeated headers, career summaries and seasons outside the stated
window. For a traded season, it keeps a supplied `TOT`, `2TM`, `3TM`, etc.
aggregate and excludes its constituent stints. Multiple stints without an
aggregate are a hard error; rates are never added or averaged. The supplied
window was validated to contain exactly one team row for every
player-season-table before the one-to-one joins on `player_id`, `season` and
`source_team`.

## Sources and row provenance

- `*CareerAvg.csv`: Basketball Reference per-game regular-season export.
- `*CareerP100P.csv`: Basketball Reference per-100-possessions regular-season export.
- `*CareerAdv.csv`: Basketball Reference advanced regular-season export.

Every normalized row records all three source filenames and row identifiers
as `filename:line_number`. No retrieval date or source URL was supplied with
these local exports, so neither is asserted here.

## Units and conventions

- `minutes_per_game` is Avg `MP`; `total_minutes` is P100P/Adv `MP`.
- `games`, `starts` and `season_age` retain their source metadata meanings.
  Season age is the source's season-age field, not current age.
- `*_per_game` values are per game. Counting statistics named `*_per_100` are
  Basketball Reference's supplied rates per 100 possessions.
- `fg_pct`, `fg3_pct`, `ft_pct`, `efg_pct` and `ts_pct` are fractions:
  `0.573` means 57.3%.
- `usage_pct`, `assist_pct`, `turnover_pct` and the retained rebound/steal/block
  percentages are percentage-point values: `36.2` means 36.2%, not 3,620%.
- `three_point_attempt_rate` (`3PAr`) and `free_throw_attempt_rate` (`FTr`) are
  ratios supplied as fractions.
- Missing source values remain empty. Nothing is zero-filled. Supplied TS% and
  other percentages are retained; they are not recalculated from rounded
  per-game or per-100 statistics.

The script validates 15 unique rows, five consecutive seasons per player,
one-to-one joins, shared metadata, P100P/Adv total minutes, total minutes per
game within source-rounding tolerance, Avg/P100P shooting percentages, numeric
ranges and finiteness, and the supplied 2025-26 checks. It does not impose
exact arithmetic identities on independently rounded advanced statistics.

Regenerate from the repository root:

```powershell
& .\.venv\Scripts\python.exe scripts\prepare_celtics_wing_comparison.py
```
