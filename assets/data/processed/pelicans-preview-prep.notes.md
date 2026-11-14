# New Orleans Pelicans preview graphics: preparation and provenance

## Frozen windows

- Current team results cover 12 games (4-8). Current player appearances are kept separately: Zion Williamson 11, Jeremiah Fears 12 and Derik Queen 12. The graphics do not combine these current windows with older seven-game snapshots.
- The rookie comparison uses completed rookie seasons only. Fears and Queen appear as 2025-26 rookies; their 2026-27 sophomore rows are not added to the comparison pool.
- The team comparison uses the completed 2025-26 season and the supplied 2026-27 12-game snapshot.

## Rookie comparison

Immediate sources:

- `assets/data/raw/Rookies_Adv_2023to26.csv`
- `assets/data/raw/Rookies_P100P_2023to26.csv`
- `assets/data/raw/Rookies_PerGame_2023to26.csv`
- `assets/data/raw/NOP/JeremiahFears_Adv.csv` (highlighted-player total minutes only)
- `assets/data/raw/NOP/DQueen_Adv.csv` (highlighted-player total minutes only)

The three-season exports already contain the qualified population: at least 15 games and 10 minutes per game. `scripts/prepare_pelicans_preview.py` resolves repeated leaf headers by occurrence, rejects duplicate keys, and joins the three tables one-to-one on Basketball-Reference player ID plus season. It validates identical key sets and the expected season counts: 43 in 2023-24, 47 in 2024-25 and 48 in 2025-26 (138 total).

`MP/G` is treated as minutes per game. The rookie comparison exports do not contain total minutes. For the highlighted supporting labels, the separate New Orleans player tables supply 2,112 minutes for Fears and 2,023 for Queen. Those files agree with the rookie exports on the plotted rates; their position labels are more specific (`PG`/`C`) than the comparison exports (`G`/`F-C`), so the comparison-export labels are retained in the cohort file.

True shooting is stored as a fraction. Points, assists and turnovers are per 100 possessions. The highlighted 2025-26 values validate as:

- Fears: 82 games, 2,112 total minutes, 26.5 points, 6.3 assists and 4.0 turnovers per 100 possessions, 52.5% true shooting.
- Queen: 81 games, 2,023 total minutes, 22.4 points, 7.0 assists and 4.5 turnovers per 100 possessions, 54.6% true shooting.

The scatterplots are descriptive across positions, roles and three rookie classes. They are not forecasts, similarity scores or composite rankings. Turnovers include more than failed passes, so the assists/turnovers panel is not labeled passing efficiency. Each panel derives both numerical domains from all 138 valid rows, adds six percent of the cohort span as padding and applies a mark-layer clip path only as a rendering safeguard; axes and labels remain outside that clipped layer. No peers are hand-selected for permanent labels. Hover, tap and one keyboard inspection target per panel expose the nearest player-season, while all 138 names and values remain in the accessible table.

Output: `assets/data/processed/pelicans-rookie-context-2023-2026.csv`.

## Zion role and current on/off offense

Immediate sources:

- `assets/data/raw/NOP/Zion_Adv.csv`
- `assets/data/raw/NOP/Zion_P100P.csv`
- `assets/data/raw/NOP/Zion_PerGame.csv`
- `assets/data/raw/NOP/Zion_PlayByPlay.csv`
- `assets/data/raw/NOP/Zion_Shooting.csv`
- `assets/data/raw/NOP/Zion_Williamson_OnOff_2026-27.csv`

All played regular seasons from 2019-20 through 2026-27 are joined by season. The transformation checks shared season identity, games, starts and the agreement of Advanced and Per 100 total minutes. The absent 2021-22 season is inserted only as `did_not_play`; performance fields remain empty. It remains explicit in the cleaned table but is omitted from the chart's evenly spaced played-season categories. The six completed played seasons are connected by solid lines. The current 2026-27 snapshot is presented in a separate summary column, outside the historical plotting area, with no timeline mark or connecting segment.

Usage percentage is already in percentage-point units. True shooting and assisted-two-point share are fractions. Assists come directly from the Per 100 table. `PerGame MP` is minutes per game; `Advanced/P100P/Shooting MP` is total minutes. Assisted-two-point share is retained in the cleaned output but not promoted to a fourth trend panel. The Play-by-Play on-court plus/minus field is retained only as supporting provenance and is not treated as an individual rating.

The 2024-25, 2025-26 and current anchors validate at 30 G / 34.7% USG / 9.0 AST per 100 / 60.0% TS; 62 G / 25.7% / 5.2 / 64.4%; and 11 G / 22.8% / 3.8 / 69.1%, respectively. The current snapshot is separated visually from completed seasons.

The 119.2 on-court and 104.2 off-court offensive ratings are observed New Orleans team results from the supplied on/off export, covering 360 and 231 minutes. They appear as a single horizontal dumbbell with a descriptive 15.0-point difference. They are unadjusted for teammates, opponents and rotation context and are not an isolated causal estimate of Zion's impact. The individual `ORtg`/`DRtg` columns in player tables are not used for this comparison.

Output: `assets/data/processed/pelicans-zion-role-2019-2027.csv`.

## Team style and defensive results

Immediate sources:

- `assets/data/raw/NOP/NOP_Team4Factors_2526.csv`
- `assets/data/raw/NOP/NOP_Team4Factors_2627.csv`
- `assets/data/raw/NOP/NOP_TeamBasic2526.csv`
- `assets/data/raw/NOP/NOP_TeamBasic_2627.csv`

The transformation selects the explicit `Team`, `Lg Rank`, `Opponent/G` and immediately following opponent `Lg Rank` rows. It resolves repeated four-factor headers by occurrence and does not derive possessions.

The source opponent 2P% rank is verified as a defensive-quality rank: lower opponent 2P% is better, with the supplied .578 ranked 29th in 2025-26 and .606 ranked 30th in 2026-27. No inversion is applied. Offensive rating, defensive rating and defensive rebound percentage likewise use their supplied 1-30 quality ranks.

Three-point attempt rate (`3PAr`) is the share of field-goal attempts taken from three. Free-throw attempt rate (`FTr`) is free-throw attempts divided by field-goal attempts; .367 is displayed as 36.7 free-throw attempts per 100 field-goal attempts. Neither is per 100 possessions. Both seasons use one fixed 0-40 scale and identical track geometry within each style panel. Their ranks are shown only as offensive-volume ranks (`highest`/`lowest`), not as quality rankings. The four result measures each use one shared 1-30 rank track with both season markers. Opponent 2P% covers every two-point attempt and is not rim or paint field-goal percentage. The team results do not assign responsibility to an individual defender.

Output: `assets/data/processed/pelicans-team-style-2025-2027.csv`.

## Reproduction

From the repository root, run:

```text
python scripts/prepare_pelicans_preview.py
```

The script fails on duplicate or unmatched rookie keys, unexpected season counts, percentage-unit changes, anchor changes, missing Zion seasons, and any change to the frozen 12-game 4-8 team window.
