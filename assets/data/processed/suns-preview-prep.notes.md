# Phoenix Suns preview graphics: preparation and provenance

## Frozen windows

- Phoenix's current team comparison covers 13 games and a 6-7 record.
- Devin Booker and Jalen Green each have 13 appearances in the supplied 2026-27 player exports.
- Completed seasons and the current snapshot are kept separate in every chart-ready file. No data was acquired or refreshed.

## Jalen Green and the All-Rookie cohort

Immediate sources:

- `assets/data/raw/PHO/JalenGreen/AllRookieTeamMembers_RookieSeason_PerGame.csv`
- `assets/data/raw/PHO/JalenGreen/AllRookies_2ndThrough6thSeason_PerGame.csv`
- `assets/data/raw/PHO/JalenGreen/Green_AdjShooting.csv`
- `assets/data/raw/PHO/JalenGreen/Green_Adv.csv`
- `assets/data/raw/PHO/JalenGreen/Green_P100P.csv`

The rookie export contains 60 unique Basketball-Reference player IDs: 10 from each rookie season from 2020-21 through 2025-26. The larger post-rookie export contains five embedded repeated header rows; those are removed before filtering. Filtering on stable player ID produces 194 unique player-season rows representing 59 of the 60 rookies. Maxime Raynaud (`raynama01`) has no post-rookie row, as expected.

The primary comparison pairs the 2020-21, 2021-22 and 2022-23 rookie classes with the season three calendar years later. All 30 expected ID-season pairs are present and unique. This is called "three seasons after the rookie year" rather than an active-experience claim. The supplied combined-team rows (for example, `INDLAC`) are already season aggregates and are retained once; they are not combined with separate stint rows.

The scatterplot labels Jalen Green plus the minimum and maximum observations on each axis. Any tied extrema are eligible for labels when they can remain legible; every other peer remains available through hover, tap, keyboard inspection and the accessible table. This rule is deterministic and does not select peers for editorial similarity.

`MP` in both cohort exports is minutes per game. True shooting is stored as a fraction. The chart-ready output expresses TS change in percentage points and PPG change in points per game. It retains rookie/comparison games, MPG, seasons and source lines. The verified medians are +3.0 PPG and +1.9 TS percentage points. Jalen Green's row validates at 17.3 PPG, 54.7% TS and 67 games as a rookie; 21.0 PPG, 54.4% TS and 82 games in 2024-25; and changes of +3.7 PPG and -0.3 TS percentage points.

These descriptive changes reflect opportunity, role, age and team context as well as development. Raw TS is not league-adjusted, and a lower starting point can leave more room for improvement.

Green's separate career output joins Adjusted Shooting, Advanced and Per 100 Possessions rows by season, checks shared games and total minutes, and verifies Advanced TS% against Adjusted Shooting TS%. TS+ is a league-relative index in which 100 is league average; it is not a percentage-point scale. Completed-season TS+ values are 97, 93, 93, 94 and 89 from 2021-22 through 2025-26. The current 13-game row is kept separate at 87 TS+, 49.9% TS and 21.8 points per 100 possessions.

Outputs:

- `assets/data/processed/suns-green-all-rookie-change.csv`
- `assets/data/processed/suns-green-career.csv`

## Devin Booker career trajectory

Immediate sources:

- `assets/data/raw/PHO/Booker/Booker_P100P.csv`
- `assets/data/raw/PHO/Booker/Booker_Adv.csv`
- `assets/data/raw/PHO/Booker/Booker_AdjShooting.csv`
- `assets/data/raw/PHO/Booker/Booker_PerGame.csv`

The transformation joins the four tables by season from 2019-20 through 2026-27. It verifies age, team, position, games and starts across sources, and checks that Adjusted Shooting, Advanced and Per 100 total minutes agree. `PerGame MP` is treated separately as minutes per game. TS% is fractional; TS+ is the league-relative index.

The completed-season plot ends at 2025-26. The 2026-27 row remains a separate 13-game summary. Source anchors match: 2022-23 at 39.2 PTS/100, 7.8 AST/100 and 103 TS+; 2023-24 at 36.7, 9.4 and 105; 2025-26 at 38.4, 8.9 and 101; and the current snapshot at 35.3, 7.8, 105 TS+ and 60.5% TS.

Output: `assets/data/processed/suns-booker-career.csv`.

## Team defense and rebounding

Immediate sources:

- `assets/data/raw/PHO/202526/PHO_Team4Factors_2526.csv`
- `assets/data/raw/PHO/202627/PHO_Team4Factors_2627.csv`

The transformation explicitly selects the `Team` and `Lg Rank` rows after resolving repeated leaf headers by occurrence. Games are the supplied wins plus losses: 82 (45-37) in 2025-26 and 13 (6-7) in 2026-27. Defensive rating is points allowed per 100 possessions, where lower is better. DRB% is the share of available defensive rebounds collected and ORB% is the share of available offensive rebounds collected; higher is better for both. These rebound fields are already in percentage units, not fractions.

Values and supplied ranks validate at 113.9 DRtg (10th), 71.9% DRB (27th) and 28.9% ORB (7th) in 2025-26; and 118.2 (24th), 67.8% (30th) and 26.5% (19th) through 13 games. Rank changes and raw-value changes compare different league environments. The current source also reports the third-hardest schedule and 15th-ranked SRS; these appear only as a compact footnote, not another panel.

Output: `assets/data/processed/suns-team-defense-rebounding.csv`.

## Reproduction

From the repository root, run:

```text
python scripts/prepare_suns_preview.py
```

The script fails on duplicate player-season keys, unexpected repeated-header counts, missing cohort pairs, incorrect percentage units, source disagreement, changed anchors or a changed 13-game/6-7 window.
