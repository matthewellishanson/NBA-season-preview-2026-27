# Clutch shooting leaders: provenance and units

- Source: the two supplied Basketball Reference Stathead shooting-query CSV exports in `assets/data/raw/`.
- Coverage: 1996–97 through 2025–26. Filters are fourth quarter or overtime, 0:00–5:00 remaining, and scoring margin from −5 to +5.
- Selection: all 25 supplied postseason rows (minimum 100 FGA), plus the first 25 ranked rows from the supplied 100-row regular-season export (minimum 300 FGA). The regular-season file is a paginated-query export, not the complete qualifying population.
- Ordering: `source_rank` and row order are preserved; no ranking is recalculated from the rounded `efg_pct` field. `player_id` comes from `Player-additional`.
- Units: count fields are cumulative totals. Percentage fields are proportions from 0 to 1. `fg_pct`, `fg3_pct`, `efg_pct`, and `assisted_share` preserve source values; `unassisted_makes = fg - assisted_makes` and `unassisted_share = unassisted_makes / fg` are calculated.
- Missingness: blank `fg3_pct` is retained when `fg3a` is zero and means undefined, not 0%.
