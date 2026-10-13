# Tyrese Maxey career trajectory data

`maxey-career-trajectory.csv` joins Tyrese Maxey's completed NBA regular seasons from 2020–21 through 2025–26. The two player-specific source exports in `assets/data/raw` are preserved unchanged:

- `MaxeyP100P.csv`: Basketball Reference **Per 100 Possessions** table; supplies points and assists per 100 possessions.
- `MaxeyAdv.csv`: Basketball Reference **Advanced** table; supplies true shooting percentage and usage percentage.

Source-table pages:

- Per 100 Possessions: https://www.basketball-reference.com/players/m/maxeyty01.html#per_poss
- Advanced: https://www.basketball-reference.com/players/m/maxeyty01.html#advanced

No retrieval date was supplied with the source files, so none is asserted here.

## Units

- `season_start_year`, `age`, `games`, and `minutes` are counts.
- `pts_per100` and `ast_per100` are Basketball Reference's supplied per-100-possession rates; they are not derived from per-game or per-48 statistics.
- `ts_pct` is decimal-scaled (`0.600` means 60.0%). True shooting percentage accounts for two-point field goals, three-point field goals, and free throws; it is not field-goal percentage.
- `usg_pct` is a percentage on a 0–100 scale (`29.4` means 29.4%).

The source files do not contain a player-name column. Because both exports are player-specific Maxey tables, the preparation script assigns the shared player identity `Tyrese Maxey`, then joins on season, player, and team. It requires exact agreement across the tables for age, team, league, position, games, starts, and minutes. It also rejects duplicate included season identities, missing required values, malformed decimals, unexpected team or league values, and incomplete expected season coverage. Repeated headers, career totals, other seasons, and a possible partial 2026–27 row are excluded before validation.

Regenerate from the repository root:

```powershell
& .\.venv\Scripts\python.exe scripts\prepare_maxey_career.py
```
