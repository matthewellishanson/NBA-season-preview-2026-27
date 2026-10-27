# Fred VanVleet / Houston on-off data preparation notes

## Source and coverage

- The input is `assets/data/raw/VanVleet_Rockets_OnOff.csv`, manually transcribed from the author-supplied Basketball Reference team on/off tables. The raw file is preserved unchanged.
- The supplied material does not document whether an off-court split includes games VanVleet missed. The published label therefore remains **VanVleet off court** and is not narrowed to bench minutes.
- No exact table URLs or retrieval date were supplied. The chart identifies Basketball Reference and the author transcription without asserting an unsupported page address or access date.

## Transformation and validation

- `scripts/prepare_vanvleet_rockets.py` validates the exact source schema, row identities and supplied values before writing the chart-ready CSV.
- The completed 2023-24 and 2024-25 seasons each contain exactly one `on` and one `off` row. Their on/off differences are calculated only from the displayed one-decimal source rates.
- The 2025-26 row is retained as a distinct full-team-season observation because VanVleet did not play. Its missing minutes value remains blank and is never converted to zero.
- Both incomplete 2026-27 rows remain in the cleaned output with `chart_included=false`. The 61 on-court minutes are too small a sample for the published comparison.
- Percentage fields are stored in percentage units: for example, `13.3` means 13.3%, not 0.133. No possessions or exact ratings are reconstructed from rounded rates and minutes.

## Interpretation

- On/off splits describe Houston lineups that differed in teammates, opponents, rotation patterns and availability; they do not isolate VanVleet's causal effect.
- The 2025-26 result describes a different roster over a full team season and is context, not a continuation of either on/off series.
- The chart therefore does not claim Houston's offense deteriorated without VanVleet. Its 118.6 full-season offensive rating was higher than every displayed 2023-24 and 2024-25 split.
