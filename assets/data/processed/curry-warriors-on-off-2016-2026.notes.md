# Curry / Warriors on-off preparation notes

## Sources and coverage

- `assets/data/raw/Curry_Warriors_OnOff_2016to2026.csv` is the author-supplied manual transcription of Basketball Reference Curry on/off team tables. It is preserved unchanged.
- Team-season source pattern: `https://www.basketball-reference.com/teams/GSW/{season-ending-year}/on-off/`.
- `assets/data/raw/LeagueAverages_P100P.csv` supplies the NBA offensive-rating baseline. Its first row is a grouped heading; the second row contains the actual CSV field names. The preparation script explicitly skips the grouped row, selects `Lg == NBA`, and joins once by season.
- The incomplete 2026-27 league row (36 league-team games in the supplied file) is explicitly excluded. The output covers 2015-16 through 2025-26, with ten observed rating seasons and an explicit 2019-20 small-sample exclusion. Curry's known 139 on-court minutes are retained in the processed data and accessible table, but 2019-20 is excluded from both plotted time panels.
- All ten transcribed `league_ortg` values were checked against the supplied league table's `ORtg` field and match exactly. The supplied 2019-20 NBA baseline is also retained even though no Curry on/off rating is charted for that season.

## Definitions and calculations

- `on_ortg` and `off_ortg` describe Golden State's team offense during Curry's on-court and off-court minutes. `on_drtg` and `off_drtg` are opponent offensive ratings during those respective minutes. They are not Curry's individual Basketball Reference ORtg or DRtg.
- `on_relative_ortg = on_ortg - league_ortg`; `off_relative_ortg = off_ortg - league_ortg`; `offensive_on_off_gap = on_ortg - off_ortg`.
- The source ratings are displayed to one decimal place. Derived differences are calculated from those intact displayed ratings with decimal arithmetic and rounded half-up to one decimal. Truncated or differently rounded pasted Difference columns are not used.
- Minutes and both defensive ratings are retained for context. No possessions, games played, exact team-season ratings, or overall rating reconstructed by minute-weighting are inferred from the supplied values.

## Interpretation limits

- The available local source notes and the supplied transcription do not establish whether Basketball Reference's off-court population includes all team minutes in games Curry missed. The chart therefore uses the plain label **Curry off court** and does not describe the group as only bench minutes from games he played.
- On/off results describe team performance during different minutes with different teammates, opponents, rotation choices and availability. They do not isolate Curry's causal effect and do not establish the strength of the 2026-27 roster.
