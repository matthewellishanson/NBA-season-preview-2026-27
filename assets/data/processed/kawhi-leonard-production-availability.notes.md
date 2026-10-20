# Kawhi Leonard production and availability: provenance and units

- Source: the six supplied Basketball Reference Per Game, Per 100 Possessions and Advanced CSV exports named in each normalized record. No source URL or retrieval date was supplied.
- Preparation: `python scripts/prepare_kawhi_leonard.py`
- Identity: the exports are player-specific but do not include a player-name or player-ID column. The script assigns Kawhi Leonard and Basketball Reference ID `leonaka01` explicitly, then joins within regular season and postseason by player ID, season, season type and source team.
- Coverage: all supplied observed career rows are retained. The main graphic filters regular seasons to 2018–19 through 2025–26; its postseason companion filters 2018–19 through 2024–25.
- Per Game `MP` is minutes per game. Per 100 and Advanced `MP` is total minutes. Per-100 counting statistics are rates per 100 possessions.
- `ts_pct` is a fraction (for example, `0.629` means 62.9%). `usage_pct` and `turnover_pct` remain supplied percentage-point values. Percentages are not recalculated from rounded rates.
- The 2021–22 regular-season row contains `Did` in every non-season field in all three exports. The script corroborates the same placeholder across those files and records confirmed nonparticipation as zero games, zero total minutes, and null production/efficiency rates; minutes per game remains undefined.
- No 2021–22 row appears in any supplied postseason table. A season-alignment record marks `no_source_row` with null games and rates; it does not infer zero games or an injury explanation. The supplied postseason coverage ends at 2024–25, so no 2025–26 postseason record is created.
- Repeated headers, blank separators and career summaries are excluded. If an export contains aggregate and constituent stint rows, the aggregate is retained and the constituents excluded before joining so they cannot be double-counted.
