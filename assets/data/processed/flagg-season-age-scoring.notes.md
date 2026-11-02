# Cooper Flagg season-age scoring comparison

## Source inputs

- `assets/data/raw/DAL/MostPointsBeforeTurning20_Adv.csv`
- `assets/data/raw/DAL/MostPointsBeforeTurning20_P100P.csv`
- `assets/data/raw/DAL/First75Games.csv` (validation context only)

The two primary files are supplied Stathead/Basketball-Reference regular-season exports. Raw inputs are preserved unchanged. The Per 100 file begins with a grouping row, which the preparation script identifies and skips before reading the actual header.

## Age-selection rule

No saved query URL, query note or source metadata was supplied, so the original Stathead age filter could not be independently reproduced. The exports contain combined records such as Kobe Bryant's 150 games across 1996-97 and 1997-98 with the source age designation `18-19`. That structure supports a season-age selection rather than an individual game-date cutoff at each player's 20th birthday.

The chart therefore uses the conservative description **“Combined scoring in seasons listed at age 19 or younger.”** This rule is inferred from the exports. The chart does not describe the totals as “points before turning 20” or “all points scored as a teenager.” A player's opportunity to appear in another qualifying season cannot be established from these files alone.

## Transformation

- `scripts/prepare_flagg_historical_scoring.py` joins the Advanced and Per 100 exports by stable Basketball-Reference player ID.
- Both files are validated as one aggregated record per player and as containing identical player-ID sets.
- The repeated Per 100 `PTS` headers are mapped by position: the first `PTS` field is total points and the second is points per 100 possessions.
- Shared player, season-span, age, games and team fields must agree across both exports. Total points must also agree.
- Missing source fields remain missing; the chart-ready file does not impute values.
- The output preserves source season endpoints, a display season span, games, team and source age designation, then retains source ranks 1 through 10 ordered by total points.

## Validation and limitations

The six supplied anchors validate exactly, including Cooper Flagg at 1,473 points in 70 games for 2025-26, sixth in this export. The separate first-75-games export validates Flagg at 1,607 points in 75 games and rank 34. That file describes a different population and window; none of its values are joined into or plotted in the season-age chart.

The historical exports' league coverage, query filters beyond the visible fields, and original query date are not documented in the supplied files. The ranking is therefore presented as a comparison within the supplied group, not as an independently reproduced all-league record.

