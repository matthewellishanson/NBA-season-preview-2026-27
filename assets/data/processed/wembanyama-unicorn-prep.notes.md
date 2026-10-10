# Wembanyama unicorn chart data

## Provenance

- Destination file: `wembanyama-unicorn-2025-26.csv`
- Immediate source: READiscover's `public/assets/story/wembanyama_unicorn.csv`
- Statistical provider: Basketball Reference. This attribution is supported by the source's Basketball Reference table names and fields (`Per 100 Possessions`, `Advanced`, `Player-additional`) and by the matching supplied Wembanyama career exports. The READiscover repository does not include the league CSV's original download URL, retrieval date, or generation script.
- Population: 2025-26 NBA regular season, 163 players with at least 1,500 minutes.
- One row per Basketball Reference player ID. Ten traded players use a single combined-team row (for example, `CLELAC`) rather than separate team stints.

## Fields and units

- `points_per_100`: points per 100 possessions, carried from the source's `PTS/100 Poss.` field. It is not a per-48 conversion.
- `dbpm`: Basketball Reference Defensive Box Plus/Minus, a box-score-based estimate of defensive points per 100 possessions relative to league average.
- `block_pct`: estimated percentage of opponent two-point field-goal attempts blocked while the player was on the floor, expressed as percentage points.
- `true_shooting_pct`: true shooting percentage stored as a decimal fraction (`0.626` = 62.6%).
- `minutes`: regular-season minutes used to verify the qualification rule.

## Preparation and verification

Run from the repository root:

```powershell
python scripts/prepare_wemby_unicorn.py C:\Users\mehan\code\readiscover_V1\public\assets\story\wembanyama_unicorn.csv
```

The script rejects missing or non-finite values, seasons other than 2025-26, rows below 1,500 minutes, duplicate player IDs, an empty population, a missing Wembanyama row, or conflicts with the supplied Wembanyama career files. Known mojibake in several player names is normalized in the output.

Verified Wembanyama values: 41.2 PTS/100, 4.2 DBPM, 9.4 BLK%, and 62.6% TS. These match `assets/data/raw/WembyP100.csv` and `assets/data/raw/WembyAdv.csv`.
