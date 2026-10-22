# Pascal Siakam career-data preparation notes

- Raw sources: `SiakamPerGameCareer.csv`, `SiakamP100PCareer.csv` and `SiakamAdvCareer.csv` in `assets/data/raw`.
- Rebuild command: `& .\.venv\Scripts\python.exe scripts\prepare_siakam_pacers.py`.
- The cleaned CSV retains all ten completed regular seasons from 2016-17 through 2025-26. The published chart selects only 2023-24 through 2025-26.
- The join key is the fixed player identifier (`siakapa01`) plus season after full-season row selection. Age, team, league, games and starts must agree across all three files, and duplicate or incomplete joins fail the build.
- If a season contains both a combined `TOT`/`2TM` record and team-stint rows, the combined record is selected. If multiple stints exist without a combined record, preparation stops rather than averaging rates.
- The supplied 2023-24 tables already contain one combined `2TM` row in every source. It is labeled `TOR/IND` in the cleaned data and chart; no Toronto and Indiana rates were averaged.
- Points per 100 possessions comes directly from the per-100 file. True shooting percentage comes directly from the advanced file and remains a decimal fraction in the cleaned data. Games and minutes per game come directly from the per-game file.
- Career summaries, repeated headers, postseason records and incomplete 2026-27-or-later records are excluded by the parser.
