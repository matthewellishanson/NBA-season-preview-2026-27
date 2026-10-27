# Michael Porter Jr. Denver-to-Brooklyn comparison

`mpj-denver-brooklyn-2024-2026.csv` contains Michael Porter Jr.'s final Denver
regular season (2024-25) and first Brooklyn regular season (2025-26). It is
generated from these supplied Basketball Reference exports in
`assets/data/raw/`, which remain unchanged:

- `MPJ_PerGame.csv`
- `MPJ_P100P.csv`
- `MPJ_Adv.csv`
- `MPJ_Shooting.csv`

`MPJ_AdjShooting.csv` and `MPJ_PlayByPlay.csv` were inspected and retained as
context, but are not needed for the displayed comparison. No retrieval date or
query URL was supplied with the local exports, so neither is asserted here.

## Join and header handling

The script joins the four displayed source tables on `Season` and `Team` and
requires one matching row in each table. Games and starts must agree across all
four sources. Total minutes must agree across Per 100, Advanced and Shooting;
Per Game `MP` is minutes per game and is checked against total minutes divided
by games within source-rounding tolerance.

`MPJ_Shooting.csv` has a grouping row followed by duplicate leaf headers. The
script combines both rows before selecting `% of FG Ast'd | 2P` and `% of FG
Ast'd | 3P`. Those fields mean the share of made two-pointers and made
three-pointers, respectively, that Basketball Reference credits as assisted.
They are not field-goal percentages, attempt shares or shot-location fields.

## Displayed metrics and units

- Games and minutes per game come from Per Game.
- Points, assists and turnovers per 100 possessions come from Per 100. They are
  not per-game or per-48 conversions.
- Usage rate and true shooting come from Advanced. `usage_pct` is stored in
  percentage-point units; `true_shooting_pct` is stored as a fraction.
- Assisted-make shares come from Shooting and are stored as fractions. Each is
  converted to a display percentage exactly once in the chart.

The script validates the displayed values exactly:

| Metric | 2024-25 DEN | 2025-26 BRK |
|---|---:|---:|
| Games | 77 | 52 |
| Minutes/game | 33.7 | 32.5 |
| Points/100 | 25.9 | 36.9 |
| Usage | 20.2% | 30.5% |
| Assists/100 | 3.1 | 4.6 |
| Turnovers/100 | 1.9 | 3.6 |
| True shooting | 61.7% | 59.5% |
| Made 2P assisted | 74.0% | 65.3% |
| Made 3P assisted | 92.2% | 85.8% |

These are descriptive season comparisons with different teams, teammates and
roles. They do not establish that role caused the efficiency changes. The
assisted-make fields do not identify catch-and-shoot, pull-up or off-screen
attempts and do not fully measure shot creation. Individual Basketball
Reference ORtg and DRtg fields are not team on-court ratings and are excluded.

Regenerate from the repository root:

```powershell
& .\.venv\Scripts\python.exe scripts\prepare_mpj_brooklyn_comparison.py
```
