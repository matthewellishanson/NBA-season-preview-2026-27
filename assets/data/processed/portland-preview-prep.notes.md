# Portland preview data preparation notes

## Source files and coverage

- The center comparison is regenerated from `assets/data/raw/FrontcourtOnly_202425to202526_Min1000MIN_Adv.csv` and `assets/data/raw/P100PStats_FrontcourtOnly_202425to202526_Min1000MIN.csv`, the same local exports and parser used by the Zach Edey graphic. The requested `(1)` filename variants are not present in the repository; the verified files are the unsuffixed paths above.
- Those exports contain source-aggregated player records for the 2024-25 and 2025-26 regular seasons combined. The Stathead query population is players filtered as C or C/F with at least 1,000 total minutes across the window. It is not every NBA big man.
- The Advanced export has one leaf header row. The Per 100 export has a grouping row followed by its leaf header. Advanced `Player-additional` and Per 100 `-9999` contain stable Basketball Reference player IDs. Both sources contain the same 72 unique IDs; the join is one-to-one by ID.
- The Portland career inputs are the eleven requested `Clingan_*.csv` and `Deni_*.csv` files under `assets/data/raw/POR/`. Grouped two-row headers in Adjusted Shooting, Play-by-Play and Shooting are parsed explicitly. The player-specific career files do not include a stable ID column, so Deni seasons are joined by season only after age, team, league, position, games and starts agree across files. No aggregate `TOT` or separate team-stint rows occur in the three selected Deni seasons.
- Both outputs exclude every 2026-27 row. The four-game current-season records remain preserved in raw inputs but are not transformed into either graphic.

## Center aggregation, units and ranks

- The supplied center records already contain correctly aggregated two-season percentage fields. ORB%, DRB% and BLK% are read directly; no season percentages are averaged or minutes-weighted. Per-100 rows validate identity, 144 combined games, 114 starts and 3,418 total minutes for Donovan Clingan (`clingdo01`).
- `MP` in the cohort export is total minutes, not minutes per game. ORB%, DRB% and BLK% are percentage-point values. Missing cells remain missing in the normalized parser and are not replaced with zero.
- Ranks use descending competition rank on source precision: 1 plus the number of valid qualifiers with a strictly higher value. Tied values share a rank. Verified Clingan profile: orb_pct 17.6% (3 of 72), drb_pct 27.6% (14 of 72), blk_pct 6.3% (T-7 of 72).
- BLK% estimates the share of opponent two-point attempts blocked while the player is on court. It does not measure complete defensive quality, rim deterrence or wins caused.

## Deni joins and units

- `portland-deni-offense-2023-2026.csv` keeps one row each for 2023-24 Washington, 2024-25 Portland and 2025-26 Portland. Advanced supplies USG%; Per 100 supplies AST/100; Adjusted Shooting supplies FTr and TS%; Per Game supplies games, MPG and editorial context. Source rows are retained as JSON for auditability.
- The Advanced/Per 100 `MP` fields are total minutes. Per Game `MP` is MPG and is stored separately. FTr and TS% are source fractions already in percentage units; chart labels multiply them by 100 for display. `fta_per_100_fga` is FTr multiplied by 100 and means free-throw attempts per 100 field-goal attempts, not per 100 possessions.
- Source AST/100 values are 5.9, 6.3 and 9.6. They are not substituted with per-game assists (3.8, 3.9 and 6.7). Empty source values remain empty; zero is retained only when the source explicitly reports zero.

## Supporting context and limitations

- Clingan's completed 2025-26 career rows verify 77 games, 77 starts, 11.6 rebounds per game, 4.5 offensive rebounds per game, 34.1% from three and 3.2 three-point attempts per game.
- Deni's three seasons describe role, playmaking volume, foul-drawing rate and scoring efficiency. They do not establish causation, a league-wide foul-drawing rank or a particular foul-drawing technique.
