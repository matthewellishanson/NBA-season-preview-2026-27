"""Prepare the Zach Edey / Memphis graphic data and provenance notes.

The two Stathead exports are combined player records. They are joined only by
the stable Basketball Reference player identifier after their distinct header
structures have been validated. The on/off file is a documented manual
transcription of values supplied by the user.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path


ADVANCED_FILE = "FrontcourtOnly_202425to202526_Min1000MIN_Adv.csv"
PER100_FILE = "P100PStats_FrontcourtOnly_202425to202526_Min1000MIN.csv"
ON_OFF_FILE = "edey-memphis-on-off-manual.csv"
PLAYER_ID_PATTERN = re.compile(r"^[a-z0-9]{8,10}$")
QUALIFIER_COUNT = 72
EDEY_ID = "edeyza01"

JOINED_COLUMNS = (
    "player_id", "player_name", "from_season", "to_season", "source_position",
    "source_team", "age_range", "games", "starts", "total_minutes", "orb_pct",
    "drb_pct", "trb_pct", "blk_pct", "usage_pct", "turnover_pct", "points_per_100",
    "orb_per_100", "drb_per_100", "trb_per_100", "blocks_per_100", "assists_per_100",
    "turnovers_per_100", "personal_fouls_per_100", "ts_pct", "efg_pct",
    "advanced_source_file", "advanced_source_line", "advanced_source_rank",
    "advanced_sort_ws_raw", "advanced_ws_raw", "per100_source_file",
    "per100_source_line", "per100_source_rank", "advanced_source_row_json",
    "per100_source_row_json",
)

PROFILE_METRICS = (
    ("orb_pct", "Offensive rebound percentage", "percentage_points"),
    ("trb_pct", "Total rebound percentage", "percentage_points"),
    ("blk_pct", "Block percentage", "percentage_points"),
    ("ts_pct", "True shooting percentage", "fraction"),
)

EXPECTED_EDEY = {
    "games": "77", "total_minutes": "1700", "orb_pct": "17.3", "trb_pct": "20.9",
    "blk_pct": "5.7", "ts_pct": ".632", "orb_per_100": "7.5",
    "trb_per_100": "18.4", "blocks_per_100": "2.9", "points_per_100": "20.8",
    "personal_fouls_per_100": "6.0",
}

EXPECTED_RANKS = {"orb_pct": 5, "trb_pct": 14, "blk_pct": 16, "ts_pct": 27}

EXPECTED_ON_OFF = (
    ("2024-25", "on", "1418", "120.1", "114.5", "5.7", "34.5", "77.4", "56.5"),
    ("2024-25", "off", "2525", "117.4", "112.9", "4.6", "25.5", "73.5", "49.6"),
    ("2025-26", "on", "284", "115.3", "97.6", "17.7", "28.5", "83.2", "58.4"),
    ("2025-26", "off", "3664", "113.7", "121.3", "-7.7", "24.4", "69.7", "46.5"),
)


class PreparationError(RuntimeError):
    """Source data failed a required structural or identity check."""


def decimal(value: str, location: str, *, allow_missing: bool = False) -> Decimal | None:
    value = value.strip()
    if not value:
        if allow_missing:
            return None
        raise PreparationError(f"Missing numeric value at {location}.")
    try:
        result = Decimal(value)
    except InvalidOperation as error:
        raise PreparationError(f"Invalid numeric value at {location}: {value!r}.") from error
    if not result.is_finite():
        raise PreparationError(f"Non-finite numeric value at {location}: {value!r}.")
    return result


def read_csv_rows(path: Path) -> list[list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        return [[cell.strip() for cell in row] for row in csv.reader(source)]


def row_object(header: list[str], values: list[str], path: Path, line: int) -> dict[str, str]:
    if len(values) != len(header):
        raise PreparationError(
            f"{path.name}:{line}: expected {len(header)} fields, found {len(values)}."
        )
    return dict(zip(header, values, strict=True))


def validate_common_headers(header: list[str], path: Path) -> None:
    required = {"Rk", "Player", "MP", "From", "To", "Age", "G", "GS", "Pos", "Team"}
    missing = required.difference(header)
    if missing:
        raise PreparationError(f"{path.name}: missing shared headers {sorted(missing)}.")


def read_advanced(path: Path) -> dict[str, dict[str, object]]:
    rows = read_csv_rows(path)
    if not rows:
        raise PreparationError(f"{path.name}: empty file.")
    header = rows[0]
    validate_common_headers(header, path)
    required = {"WS▼", "WS", "ORB%", "DRB%", "TRB%", "BLK%", "USG%", "TOV%", "Player-additional"}
    missing = required.difference(header)
    if missing:
        raise PreparationError(f"{path.name}: missing Advanced headers {sorted(missing)}.")

    output: dict[str, dict[str, object]] = {}
    for line, values in enumerate(rows[1:], 2):
        if not values or not any(values):
            continue
        row = row_object(header, values, path, line)
        player_id = row["Player-additional"]
        if not PLAYER_ID_PATTERN.fullmatch(player_id):
            raise PreparationError(f"{path.name}:{line}: invalid Player-additional {player_id!r}.")
        if player_id in output:
            raise PreparationError(f"{path.name}:{line}: duplicate player ID {player_id}.")
        sort_ws = decimal(row["WS▼"], f"{path.name}:{line} WS▼")
        canonical_ws = decimal(row["WS"], f"{path.name}:{line} WS")
        if sort_ws != canonical_ws:
            raise PreparationError(
                f"{path.name}:{line}: WS▼ ({sort_ws}) and WS ({canonical_ws}) disagree."
            )
        output[player_id] = {"row": row, "line": line}
    return output


def read_per100(path: Path) -> dict[str, dict[str, object]]:
    rows = read_csv_rows(path)
    header_index = next(
        (index for index, row in enumerate(rows) if len(row) > 1 and row[0] == "Rk" and row[1] == "Player"),
        None,
    )
    if header_index is None or header_index == 0:
        raise PreparationError(f"{path.name}: expected a grouping row before the Rk/Player header.")
    grouping_row = rows[header_index - 1]
    if "Per 100 Possessions" not in grouping_row:
        raise PreparationError(f"{path.name}: grouping row did not identify Per 100 Possessions.")
    header = rows[header_index]
    validate_common_headers(header, path)
    required = {"PTS", "ORB", "DRB", "TRB", "BLK▼", "AST", "TOV", "PF", "TS%", "eFG%", "-9999"}
    missing = required.difference(header)
    if missing:
        raise PreparationError(f"{path.name}: missing Per 100 headers {sorted(missing)}.")

    output: dict[str, dict[str, object]] = {}
    for line, values in enumerate(rows[header_index + 1 :], header_index + 2):
        if not values or not any(values):
            continue
        row = row_object(header, values, path, line)
        player_id = row["-9999"]
        if not PLAYER_ID_PATTERN.fullmatch(player_id):
            raise PreparationError(
                f"{path.name}:{line}: -9999 does not contain a valid player ID: {player_id!r}."
            )
        if player_id in output:
            raise PreparationError(f"{path.name}:{line}: duplicate player ID {player_id}.")
        output[player_id] = {"row": row, "line": line}
    return output


def shared_value(player_id: str, advanced: dict[str, str], per100: dict[str, str], column: str) -> str:
    if advanced[column] != per100[column]:
        raise PreparationError(
            f"{player_id}: shared {column} disagrees (Advanced {advanced[column]!r}; Per 100 {per100[column]!r})."
        )
    return advanced[column]


def normalized_number(value: str, location: str, *, allow_missing: bool = False) -> str:
    result = decimal(value, location, allow_missing=allow_missing)
    return "" if result is None else value.strip()


def prepare_joined(raw_dir: Path) -> list[dict[str, str]]:
    advanced_path = raw_dir / ADVANCED_FILE
    per100_path = raw_dir / PER100_FILE
    advanced = read_advanced(advanced_path)
    per100 = read_per100(per100_path)
    if len(advanced) != QUALIFIER_COUNT or len(per100) != QUALIFIER_COUNT:
        raise PreparationError(
            f"Expected {QUALIFIER_COUNT} unique IDs in each export; found Advanced {len(advanced)}, Per 100 {len(per100)}."
        )
    if set(advanced) != set(per100):
        raise PreparationError(
            f"Player-ID coverage differs: Advanced-only {sorted(set(advanced) - set(per100))}; "
            f"Per-100-only {sorted(set(per100) - set(advanced))}."
        )

    joined: list[dict[str, str]] = []
    for player_id in sorted(advanced):
        adv = advanced[player_id]
        p100 = per100[player_id]
        adv_row = adv["row"]
        p100_row = p100["row"]
        assert isinstance(adv_row, dict) and isinstance(p100_row, dict)
        common = {
            column: shared_value(player_id, adv_row, p100_row, column)
            for column in ("Player", "MP", "From", "To", "Age", "G", "GS", "Pos", "Team", "WS")
        }
        record = {
            "player_id": player_id,
            "player_name": common["Player"],
            "from_season": common["From"],
            "to_season": common["To"],
            "source_position": common["Pos"],
            "source_team": common["Team"],
            "age_range": common["Age"],
            "games": normalized_number(common["G"], f"{player_id} G"),
            "starts": normalized_number(common["GS"], f"{player_id} GS"),
            "total_minutes": normalized_number(common["MP"], f"{player_id} MP"),
            "orb_pct": normalized_number(adv_row["ORB%"], f"{player_id} ORB%", allow_missing=True),
            "drb_pct": normalized_number(adv_row["DRB%"], f"{player_id} DRB%", allow_missing=True),
            "trb_pct": normalized_number(adv_row["TRB%"], f"{player_id} TRB%", allow_missing=True),
            "blk_pct": normalized_number(adv_row["BLK%"], f"{player_id} BLK%", allow_missing=True),
            "usage_pct": normalized_number(adv_row["USG%"], f"{player_id} USG%", allow_missing=True),
            "turnover_pct": normalized_number(adv_row["TOV%"], f"{player_id} TOV%", allow_missing=True),
            "points_per_100": normalized_number(p100_row["PTS"], f"{player_id} PTS/100", allow_missing=True),
            "orb_per_100": normalized_number(p100_row["ORB"], f"{player_id} ORB/100", allow_missing=True),
            "drb_per_100": normalized_number(p100_row["DRB"], f"{player_id} DRB/100", allow_missing=True),
            "trb_per_100": normalized_number(p100_row["TRB"], f"{player_id} TRB/100", allow_missing=True),
            "blocks_per_100": normalized_number(p100_row["BLK▼"], f"{player_id} BLK/100", allow_missing=True),
            "assists_per_100": normalized_number(p100_row["AST"], f"{player_id} AST/100", allow_missing=True),
            "turnovers_per_100": normalized_number(p100_row["TOV"], f"{player_id} TOV/100", allow_missing=True),
            "personal_fouls_per_100": normalized_number(p100_row["PF"], f"{player_id} PF/100", allow_missing=True),
            "ts_pct": normalized_number(p100_row["TS%"], f"{player_id} TS%", allow_missing=True),
            "efg_pct": normalized_number(p100_row["eFG%"], f"{player_id} eFG%", allow_missing=True),
            "advanced_source_file": ADVANCED_FILE,
            "advanced_source_line": str(adv["line"]),
            "advanced_source_rank": adv_row["Rk"],
            "advanced_sort_ws_raw": adv_row["WS▼"],
            "advanced_ws_raw": adv_row["WS"],
            "per100_source_file": PER100_FILE,
            "per100_source_line": str(p100["line"]),
            "per100_source_rank": p100_row["Rk"],
            "advanced_source_row_json": json.dumps(adv_row, ensure_ascii=False, separators=(",", ":")),
            "per100_source_row_json": json.dumps(p100_row, ensure_ascii=False, separators=(",", ":")),
        }
        if tuple(record) != JOINED_COLUMNS:
            raise PreparationError(f"{player_id}: joined schema order changed unexpectedly.")
        joined.append(record)

    if len({row["player_id"] for row in joined}) != QUALIFIER_COUNT:
        raise PreparationError("Joined player IDs are not unique.")
    return joined


def prepare_profile(joined: list[dict[str, str]]) -> list[dict[str, str]]:
    by_id = {row["player_id"]: row for row in joined}
    edey = by_id.get(EDEY_ID)
    if not edey or edey["player_name"] != "Zach Edey":
        raise PreparationError("Zach Edey's stable ID or player name was not found as expected.")
    for field, expected in EXPECTED_EDEY.items():
        if edey[field] != expected:
            raise PreparationError(f"Edey {field}: expected {expected!r}, found {edey[field]!r}.")

    output: list[dict[str, str]] = []
    for field, label, unit in PROFILE_METRICS:
        valid = [(row["player_id"], decimal(row[field], f"{row['player_id']} {field}")) for row in joined if row[field]]
        if len(valid) != QUALIFIER_COUNT:
            raise PreparationError(
                f"{field}: expected {QUALIFIER_COUNT} valid observations, found {len(valid)}; cannot label rank of 72."
            )
        edey_value = decimal(edey[field], f"Edey {field}")
        assert edey_value is not None
        rank = 1 + sum(1 for _, value in valid if value is not None and value > edey_value)
        tied = sum(1 for _, value in valid if value == edey_value) > 1
        if rank != EXPECTED_RANKS[field]:
            raise PreparationError(f"Edey {field}: expected rank {EXPECTED_RANKS[field]}, computed {rank}.")
        display_value = f"{edey_value:.1f}%" if unit == "percentage_points" else f"{edey_value * 100:.1f}%"
        output.append({
            "player_id": EDEY_ID,
            "player_name": edey["player_name"],
            "metric_key": field,
            "metric_label": label,
            "source_value": edey[field],
            "unit": unit,
            "display_value": display_value,
            "rank": str(rank),
            "rank_display": f"T-{rank}" if tied else str(rank),
            "is_tied": "true" if tied else "false",
            "valid_qualifiers": str(len(valid)),
            "ranking_method": "descending_competition_rank_strictly_higher",
        })
    return output


def prepare_on_off(raw_dir: Path) -> list[dict[str, str]]:
    path = raw_dir / ON_OFF_FILE
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    expected_header = [
        "season", "split", "minutes", "team_ortg", "opponent_ortg", "source_net_rating",
        "team_orb_pct", "team_drb_pct", "team_trb_pct",
    ]
    if rows and list(rows[0]) != expected_header:
        raise PreparationError(f"{path.name}: transcription header changed unexpectedly.")
    actual = [tuple(row[column].strip() for column in expected_header) for row in rows]
    if tuple(actual) != EXPECTED_ON_OFF:
        raise PreparationError(f"{path.name}: manual transcription does not match the supplied four rows.")

    processed: list[dict[str, str]] = []
    for line, row in enumerate(rows, 2):
        for field in expected_header[2:]:
            decimal(row[field], f"{path.name}:{line} {field}")
        processed.append({
            **{column: row[column].strip() for column in expected_header},
            "team_drtg": row["opponent_ortg"].strip(),
            "source_file": ON_OFF_FILE,
            "source_line": str(line),
            "source_method": "manual_transcription_from_user_supplied_basketball_reference_table",
        })

    by_season = {
        season: {row["split"]: row for row in processed if row["season"] == season}
        for season in ("2024-25", "2025-26")
    }
    expected_differences = {
        "2024-25": (Decimal("9.0"), Decimal("3.9"), Decimal("1.1")),
        "2025-26": (Decimal("4.1"), Decimal("13.5"), Decimal("25.4")),
    }
    for season, expected in expected_differences.items():
        splits = by_season[season]
        if set(splits) != {"on", "off"}:
            raise PreparationError(f"{season}: expected one on and one off row.")
        on, off = splits["on"], splits["off"]
        calculated = (
            decimal(on["team_orb_pct"], "on ORB") - decimal(off["team_orb_pct"], "off ORB"),
            decimal(on["team_drb_pct"], "on DRB") - decimal(off["team_drb_pct"], "off DRB"),
            decimal(on["source_net_rating"], "on net") - decimal(off["source_net_rating"], "off net"),
        )
        if calculated != expected:
            raise PreparationError(f"{season}: on/off differences {calculated} != {expected}.")
    return processed


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def notes_text(profile: list[dict[str, str]]) -> str:
    ranks = ", ".join(f"{row['metric_key']} {row['rank_display']}" for row in profile)
    return f"""# Zach Edey / Memphis data preparation notes

## Population and join

- Regular-season combined player records for 2024-25 and 2025-26, filtered in Stathead to players who played C or C/F and logged at least 1,000 total minutes across the window. This is not every NBA big man, and the source position strings include multiple center/forward variants.
- Both supplied exports contain 72 unique stable player IDs with identical coverage. Advanced uses `Player-additional`; Per 100 uses the anomalous `-9999` header, whose values were verified as player IDs before being mapped to `player_id`.
- The Per 100 grouping row is removed explicitly. Sort indicators are cleaned by explicit field mappings (`BLK▼` to blocks per 100); source ranks are retained only as provenance. Advanced `WS▼` and `WS` agree for every row and are preserved separately in provenance.
- The one-to-one join uses stable player ID, never source rank or row order. Player name, games, starts, total minutes, date range, age range, source position, source team and win shares agree across exports.
- Each joined row retains source filenames, line numbers, source ranks and JSON copies of both original source rows. Missing source values remain empty.

## Units and ranks

- `MP` is combined total minutes. Per 100 counting fields are per 100 possessions. ORB%, DRB%, TRB%, BLK%, USG% and TOV% are percentage-point values. TS% and eFG% are fractions.
- The four chart ranks use descending competition rank independently for each metric: 1 plus the count of valid qualifiers with a strictly higher supplied value. All four metrics have 72 valid observations. Equal supplied values share a rank and receive a `T-` display prefix.
- Verified Edey ranks: {ranks}. Combined production is historical, not a projection of a larger role.

## Metric definitions

- Individual ORB% and TRB% estimate shares of available rebounds collected while the player was on the floor. BLK% estimates the share of opponent two-point attempts blocked. TS% incorporates field goals, three-pointers and free throws.
- The Memphis on/off percentages are team results from the Team block of Basketball Reference's Edey on/off tables; team ORB% is not Edey's individual ORB%. `opponent_ortg` is displayed as Memphis defensive rating. `source_net_rating` preserves the supplied Team-minus-Opponent ORtg value, which can differ by 0.1 from subtraction of displayed rounded ratings.
- The on/off CSV is a manual transcription supplied by the user. No retrieval timestamp or exact query URL was provided, so none is asserted. The pasted source's On-minus-Off MP entries were percentages of team minutes, not minute differences; they are not used here. The explicit On/Off minutes are preserved instead.
- On/off comparisons describe Memphis during different minutes with different teammates and opponents; they do not isolate Edey's causal effect. The 2025-26 on-court sample is 284 minutes.
- On-court minutes total 1,702 in the on/off source versus 1,700 in Stathead. The two-minute discrepancy is preserved and its cause is unverified. No pooled two-season rate is calculated because possession and rebound-opportunity denominators were not supplied.
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument("--processed-dir", type=Path, default=Path("assets/data/processed"))
    args = parser.parse_args()

    joined = prepare_joined(args.raw_dir)
    profile = prepare_profile(joined)
    on_off = prepare_on_off(args.raw_dir)
    write_csv(args.processed_dir / "edey-frontcourt-2024-2026.csv", joined)
    write_csv(args.processed_dir / "edey-rank-profile.csv", profile)
    write_csv(args.processed_dir / "edey-memphis-on-off.csv", on_off)
    (args.processed_dir / "edey-memphis-prep.notes.md").write_text(
        notes_text(profile), encoding="utf-8"
    )
    print(f"PASS: {len(joined)} unique players joined one-to-one; identical ID coverage.")
    print("PASS: shared identity, games, minutes, date range, position, team and WS metadata agree.")
    print("PASS: Advanced sort-WS and WS agree; Per 100 -9999 mapped to verified player IDs.")
    print("PASS: four Edey metrics have 72 valid observations and expected competition ranks.")
    print("PASS: four on/off rows match the supplied transcription and expected differences.")


if __name__ == "__main__":
    main()
