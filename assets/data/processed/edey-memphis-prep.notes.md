# Zach Edey / Memphis data preparation notes

## Population and join

- Regular-season combined player records for 2024-25 and 2025-26, filtered in Stathead to players who played C or C/F and logged at least 1,000 total minutes across the window. This is not every NBA big man, and the source position strings include multiple center/forward variants.
- Both supplied exports contain 72 unique stable player IDs with identical coverage. Advanced uses `Player-additional`; Per 100 uses the anomalous `-9999` header, whose values were verified as player IDs before being mapped to `player_id`.
- The Per 100 grouping row is removed explicitly. Sort indicators are cleaned by explicit field mappings (`BLK▼` to blocks per 100); source ranks are retained only as provenance. Advanced `WS▼` and `WS` agree for every row and are preserved separately in provenance.
- The one-to-one join uses stable player ID, never source rank or row order. Player name, games, starts, total minutes, date range, age range, source position, source team and win shares agree across exports.
- Each joined row retains source filenames, line numbers, source ranks and JSON copies of both original source rows. Missing source values remain empty.

## Units and ranks

- `MP` is combined total minutes. Per 100 counting fields are per 100 possessions. ORB%, DRB%, TRB%, BLK%, USG% and TOV% are percentage-point values. TS% and eFG% are fractions.
- The four chart ranks use descending competition rank independently for each metric: 1 plus the count of valid qualifiers with a strictly higher supplied value. All four metrics have 72 valid observations. Equal supplied values share a rank and receive a `T-` display prefix.
- Verified Edey ranks: orb_pct 5, trb_pct 14, blk_pct 16, ts_pct 27. Combined production is historical, not a projection of a larger role.

## Metric definitions

- Individual ORB% and TRB% estimate shares of available rebounds collected while the player was on the floor. BLK% estimates the share of opponent two-point attempts blocked. TS% incorporates field goals, three-pointers and free throws.
- The Memphis on/off percentages are team results from the Team block of Basketball Reference's Edey on/off tables; team ORB% is not Edey's individual ORB%. `opponent_ortg` is displayed as Memphis defensive rating. `source_net_rating` preserves the supplied Team-minus-Opponent ORtg value, which can differ by 0.1 from subtraction of displayed rounded ratings.
- The on/off CSV is a manual transcription supplied by the user. No retrieval timestamp or exact query URL was provided, so none is asserted. The pasted source's On-minus-Off MP entries were percentages of team minutes, not minute differences; they are not used here. The explicit On/Off minutes are preserved instead.
- On/off comparisons describe Memphis during different minutes with different teammates and opponents; they do not isolate Edey's causal effect. The 2025-26 on-court sample is 284 minutes.
- On-court minutes total 1,702 in the on/off source versus 1,700 in Stathead. The two-minute discrepancy is preserved and its cause is unverified. No pooled two-season rate is calculated because possession and rebound-opportunity denominators were not supplied.
