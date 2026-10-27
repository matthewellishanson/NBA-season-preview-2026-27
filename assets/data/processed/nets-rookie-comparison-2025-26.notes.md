# Brooklyn rookie comparison data

`nets-rookie-comparison-2025-26.csv` contains five featured 2025-26 Brooklyn
rookie seasons plus one benchmark row. It is generated from these preserved
Stathead/Basketball Reference regular-season exports in `assets/data/raw/`:

- `Rookies_Adv_2023to26.csv`
- `Rookies_P100P_2023to26.csv`
- `Rookies_PerGame_2023to26.csv`

The source population contains 138 qualified rookie player-seasons from
2023-24 through 2025-26. Qualification is at least 15 games and 10 minutes per
game. The season counts are 43 in 2023-24, 47 in 2024-25 and 48 in 2025-26.
The chart benchmark is the median of all 138 player-seasons, not an NBA league
average and not the median of only the 48-player 2025-26 class.

## Join and source conventions

The advanced export has one header row. The per-game and per-100 exports have
a grouping row before their leaf headers. All three exports contain two `G`
columns; the preparation script gives duplicate leaf headers stable occurrence
suffixes and verifies that the two games values agree on every row.

The stable Basketball Reference ID is `Player-additional` in the advanced
file and `-9999` in the per-game and per-100 files. The script joins all three
tables one-to-one on that ID plus `Season`, never on player names. This matters
because the supplied display names for Egor Demin and Nolan Traore contain a
replacement character. The chart uses explicit editorial display names while
retaining `demineg01` and `traorno01` as their identities.

Every featured output row records the source filename and physical line number
for all three inputs. No source URL or retrieval date was supplied with the
local exports, so neither is asserted here.

## Metrics and units

- `games` and `minutes_per_game` come from the per-game export and establish
  opportunity.
- `points_per_100`, `assists_per_100` and `turnovers_per_100` are supplied
  Basketball Reference rates per 100 possessions, not per-game or per-48
  conversions.
- `true_shooting_pct` is stored as a fraction: `0.561` displays as 56.1%.
- `usage_pct` is stored in percentage-point units: `18.8` displays as 18.8%.
- Turnovers and usage are retained for role context and validation but omitted
  from the primary graphic to keep five equal player rows readable.

The benchmark row contains exact medians from the 138 qualified player-seasons:
57 games, 20.3 minutes per game, 17.9 points per 100, 4.05 assists per 100 and
0.548 true shooting. The graphic displays assists to one decimal (4.1) and true
shooting as 54.8%.

These statistics describe rookie opportunity, offensive role and production.
They do not prove or disprove star potential, rank overall talent, project
careers, capture every contribution, or imply that per-100 rates would remain
constant with more minutes.

Regenerate from the repository root:

```powershell
& .\.venv\Scripts\python.exe scripts\prepare_nets_rookie_comparison.py
```
