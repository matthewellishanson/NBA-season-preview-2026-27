# Jalen Duren season comparison data

`duren-season-comparison-2022-2026.csv` is generated from the six supplied
Jalen Duren Per Game, Per 100 Possessions and Advanced Basketball Reference
exports in `assets/data/raw/`. It contains four regular seasons (2022-23
through 2025-26) and two whole-postseason totals (2024-25 and 2025-26).

Run `python scripts/prepare_duren_season_comparison.py` from the repository
root to reproduce it. The preparer removes repeated headers and summaries,
resolves a supplied aggregate ahead of any constituent stints, rejects
ambiguous multi-stint rates, and joins one-to-one on player ID, player name,
season, season type and source team. Original filenames and row identifiers
remain in the normalized output.

Per Game `MP` is minutes per game. Per 100 and Advanced `MP` is total minutes;
their values must agree, and total minutes divided by games must match MPG
within source-rounding tolerance. Per-100 counting statistics are rates per
100 possessions. TS% is retained as a fraction; USG%, TRB%, TOV%, ORB% and
DRB% are retained as percentage-point values. Source percentages are not
reconstructed. A blank or absent 3P% is permitted and is not normalized
because it is outside this graphic's retained fields.
