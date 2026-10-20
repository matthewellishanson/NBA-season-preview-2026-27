# Darius Garland availability and production data

`garland-clippers-2021-2026.csv` is generated from `GarlandPerGame.csv`,
`GarlandP100P.csv` and `GarlandAdv.csv` in `assets/data/raw/`. Run
`python scripts/prepare_garland_clippers.py` from the repository root to
reproduce it. The raw files remain unchanged.

The output contains one regular-season row for each completed season from
2021-22 through 2025-26. Earlier seasons, career summaries, preseason,
postseason and any future 2026-27 rows are outside the requested window. The
source exports do not include a player ID, so the preparation code supplies
Garland's stable Basketball Reference ID, `garlada01`, and joins the tables
one-to-one by that configured player identity and season. Age, team, league,
position, games and starts must also agree across all three sources, preventing
a many-to-many join from passing validation.

The 2025-26 row is the supplied `2TM` combined total in all three tables. No
individual team-stint rows are present in these exports, so `team_stints` is
blank and no separate stint file can be produced. If future inputs contain
both a combined row and constituent stints, the script selects the combined
row and records the excluded stints in its run output. Multiple stints without
a combined row fail preparation; advanced rates are never summed or simply
averaged.

Per Game `MP` is minutes per game. Per 100 and Advanced `MP` is total minutes;
those total-minute fields must agree, and total minutes divided by games must
match MPG within source rounding tolerance. Points and assists per 100 are
used directly from the Per 100 file. TS% is retained as a fraction from the
Advanced file. Each covered NBA regular season used the standard 82-game team
schedule. That applicability was cross-checked against the local normalized
team-ratings file: Cleveland and the Clippers each have 82 decisions in every
covered season. `games_not_played` is therefore `82 - games`; it is an
appearance reference and does not assign an injury or any other cause to an
absence. No compatible league-average TS% series exists in the local project
inputs, so none is added.
