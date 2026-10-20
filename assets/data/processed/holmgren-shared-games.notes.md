# Holmgren shared-game chart: preparation and provenance

## Supplied files and represented populations

- `Chet_RegSeason_PerGame.csv` contains one explicit player-season row: Chet Holmgren with Oklahoma City in the 2025-26 regular season (69 games). It is a rounded per-game season aggregate.
- `ChetVsWemby_RegSeason_PerGame.csv` contains two player rows, one for Holmgren and one for Victor Wembanyama, each with 8 games. It has no season, date, opponent, lineup, possession or defender fields. The matching game counts and filename support describing it only as a supplied shared-game regular-season aggregate. Its season coverage is unspecified.
- `ChetVsWemby_Postseason_PerGame.csv` has the same two-row structure for 7 postseason games and likewise has no season, date, lineup, possession or defender fields.
- None of the files contains individual games. No repeated header or career-summary row is present in the supplied copies, but the preparation script removes those row types if they appear in a future export.

The matchup files do **not** establish possessions with both players on the floor or direct defensive assignments. They also do not support conclusions about Holmgren's defense against Wembanyama.

## Why there is no “other games” split

The only full-season baseline supplied for Holmgren is 2025-26. The regular-season shared-game file is an untagged career aggregate. Subtracting it from the 2025-26 season would mix incompatible populations, so the chart does not manufacture a 2025-26 “all other games” group. The full-season row is retained as context and is labeled as including any qualifying matchup games.

The postseason file has no compatible all-other-opponents playoff baseline, so it is shown as a separate summary.

## Calculations and rounding limits

Run:

```powershell
& .\.venv\Scripts\python.exe scripts\prepare_holmgren_matchup.py
```

The source exposes per-game averages rounded to one decimal rather than exact totals. The script reconstructs approximate totals as `G × per-game value`, then calculates:

- points per 36 minutes: `(PTS/G × 36) / (MP/G)`;
- rebounds per 36 minutes: `(TRB/G × 36) / (MP/G)`;
- true shooting percentage: `(PTS/G) / [2 × ((FGA/G) + 0.44 × (FTA/G))]`.

Because the game count cancels in these formulas, this is equivalent to calculation from the reconstructed summed inputs, but every result remains approximate because each input was rounded before export. Approximate total minutes are retained to one decimal and displayed with an approximation sign. Rates are display-rounded to one decimal; the processed CSV retains two decimals for per-36 rates and four decimals for TS%.

## Validation anchors

The preparation script checks player identities, equal game counts within both two-player shared-game files, valid denominators, unique output keys and these representative results:

| Sample | G | MPG | Approx. MP | PTS/36 | REB/36 | TS% |
|---|---:|---:|---:|---:|---:|---:|
| 2025-26 full regular season | 69 | 28.9 | 1,994.1 | 21.30 | 11.09 | 65.25% |
| Supplied career shared regular-season games | 8 | 29.3 | 234.4 | 16.96 | 9.22 | 61.04% |
| Supplied shared postseason games | 7 | 29.9 | 209.3 | 12.88 | 8.55 | 59.92% |

The lower rates in the supplied shared-game aggregates are descriptive. The source windows are insufficient to establish a same-season decline, a Wembanyama effect or a causal matchup explanation.
