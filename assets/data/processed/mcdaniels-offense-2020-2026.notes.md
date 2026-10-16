# Jaden McDaniels offensive-development data

`mcdaniels-offense-2020-2026.csv` is generated from the six supplied Jaden
McDaniels Avg, Per 100 Possessions and Advanced Basketball Reference exports
in `assets/data/raw/`. It retains six regular seasons (2020-21 through
2025-26) and four postseasons (2021-22, 2023-24, 2024-25 and 2025-26).

Run `python scripts/prepare_mcdaniels_offense.py` from the repository root to
reproduce it. The preparer removes repeated headers and summaries, selects an
aggregate ahead of constituent stints without averaging rates, rejects
ambiguous duplicates, and joins one-to-one on player ID, player name, season,
season type and source team. Original filenames and row identifiers remain in
the normalized output.

Avg `MP` is minutes per game. Per 100 and Advanced `MP` is total minutes;
their values must agree, and total minutes divided by games must match MPG
within source-rounding tolerance. Per-100 counting statistics are rates per
100 possessions. TS% and 3P% are retained as fractions. USG%, TRB%, AST% and
TOV% are retained as percentage-point values. Source percentages are not
reconstructed, and missing values remain blank rather than becoming zero.
