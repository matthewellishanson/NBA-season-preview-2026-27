# Walker Kessler Lakers chart: provenance and units

- Source: the three supplied Basketball Reference regular-season exports `KesslerRegSeason_PerGame.csv`, `KesslerRegSeason_P100P.csv` and `KesslerRegSeason_Adv.csv`. No retrieval date or source URL was supplied.
- Preparation: `python scripts/prepare_kessler_lakers.py`
- Identity and join: the player-specific exports do not contain player-name or player-ID columns. The script assigns Walker Kessler and Basketball Reference ID `kesslwa01`, then performs a validated one-to-one join on player ID, season and source team. All four selected source-team values are `UTA`.
- Coverage: four regular seasons, 2022–23 through 2025–26. Blank rows, repeated headers and Career/Season summaries are excluded if present. Duplicate real rows, missing join partners, unexpected seasons and conflicting metadata cause preparation to fail.
- Units: Per Game `MP` is `minutes_per_game`; Per 100 Possessions and Advanced `MP` is `total_minutes`. Counting statistics from the Per 100 source are rates per 100 possessions.
- Percentages: `offensive_rebound_pct`, `defensive_rebound_pct`, `total_rebound_pct`, `block_pct`, `usage_pct` and `turnover_pct` preserve supplied percentage-point values, so `14.9` means 14.9%. `ts_pct` preserves the supplied fraction, so `0.702` means 70.2%. The supplied Per Game `FG%`, `FT%` and `eFG%` are also fractions but are not retained because they are outside the requested output schema.
- Missing values remain empty. Supplied percentages are not recalculated from rounded counting statistics. Each output row retains every source filename and its original one-based CSV line identifier.
