"""Prepare the Celtics three-wing, five-season comparison dataset.

The nine inputs are player-specific Basketball Reference regular-season
exports. Player identity is assigned only through the explicit filename map
below; it is never inferred from row position.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path


SEASONS = tuple(f"{year}-{str(year + 1)[-2:]}" for year in range(2021, 2026))
LEAGUE = "NBA"
MPG_ROUNDING_TOLERANCE = Decimal("0.051")
AGGREGATE_TEAM = re.compile(r"^(?:TOT|\d+TM)$")

# This mapping is the player-identity and table-type provenance contract.
FILE_PLAYER_MAP = {
    "BrownCareerAvg.csv": ("jaylen_brown", "Jaylen Brown", "avg"),
    "BrownCareerP100P.csv": ("jaylen_brown", "Jaylen Brown", "p100"),
    "BrownCareerAdv.csv": ("jaylen_brown", "Jaylen Brown", "adv"),
    "TatumCareerAvg.csv": ("jayson_tatum", "Jayson Tatum", "avg"),
    "TatumCareerP100P.csv": ("jayson_tatum", "Jayson Tatum", "p100"),
    "TatumCareerAdv.csv": ("jayson_tatum", "Jayson Tatum", "adv"),
    "PaulGeorgeCareerAvg.csv": ("paul_george", "Paul George", "avg"),
    "PaulGeorgeCareerP100P.csv": ("paul_george", "Paul George", "p100"),
    "PaulGeorgeCareerAdv.csv": ("paul_george", "Paul George", "adv"),
}

COMMON_COLUMNS = ("Season", "Age", "Team", "Lg", "Pos", "G", "GS", "MP")
REQUIRED_COLUMNS = {
    "avg": COMMON_COLUMNS
    + ("PTS", "TRB", "AST", "FG%", "3P%", "FT%", "eFG%"),
    "p100": COMMON_COLUMNS
    + ("PTS", "TRB", "AST", "TOV", "FGA", "FTA", "3PA", "FG%", "3P%", "FT%", "eFG%"),
    "adv": COMMON_COLUMNS
    + ("TS%", "USG%", "AST%", "TOV%", "3PAr", "FTr", "ORB%", "DRB%", "TRB%", "STL%", "BLK%"),
}

OUTPUT_COLUMNS = (
    "player_id",
    "player_name",
    "season",
    "season_start",
    "season_age",
    "source_team",
    "league",
    "position",
    "games",
    "starts",
    "minutes_per_game",
    "total_minutes",
    "points_per_game",
    "rebounds_per_game",
    "assists_per_game",
    "points_per_100",
    "rebounds_per_100",
    "assists_per_100",
    "turnovers_per_100",
    "fga_per_100",
    "fta_per_100",
    "fg3a_per_100",
    "fg_pct",
    "fg3_pct",
    "ft_pct",
    "efg_pct",
    "ts_pct",
    "usage_pct",
    "assist_pct",
    "turnover_pct",
    "three_point_attempt_rate",
    "free_throw_attempt_rate",
    "offensive_rebound_pct",
    "defensive_rebound_pct",
    "total_rebound_pct",
    "steal_pct",
    "block_pct",
    "avg_source_file",
    "avg_source_row_id",
    "p100_source_file",
    "p100_source_row_id",
    "adv_source_file",
    "adv_source_row_id",
)


class PreparationError(RuntimeError):
    """A clear validation error caused by source data or configuration."""


def decimal_value(value: str, *, location: str, required: bool = True) -> Decimal | None:
    stripped = value.strip()
    if not stripped:
        if required:
            raise PreparationError(f"Missing numeric value at {location}.")
        return None
    try:
        number = Decimal(stripped)
    except InvalidOperation as error:
        raise PreparationError(f"Invalid numeric value at {location}: {value!r}.") from error
    if not number.is_finite():
        raise PreparationError(f"Non-finite numeric value at {location}: {value!r}.")
    return number


def integer_value(value: str, *, location: str) -> int:
    number = decimal_value(value, location=location)
    assert number is not None
    if number != number.to_integral_value():
        raise PreparationError(f"Expected an integer at {location}, found {value!r}.")
    return int(number)


def decimal_text(value: Decimal | None) -> str:
    if value is None:
        return ""
    return format(value, "f")


def fraction_text(value: str, *, location: str) -> str:
    number = decimal_value(value, location=location)
    assert number is not None
    if not Decimal("0") <= number <= Decimal("1"):
        raise PreparationError(f"Fraction outside [0, 1] at {location}: {number}.")
    return decimal_text(number)


def percentage_point_text(value: str, *, location: str) -> str:
    number = decimal_value(value, location=location)
    assert number is not None
    if not Decimal("0") <= number <= Decimal("100"):
        raise PreparationError(f"Percentage outside [0, 100] at {location}: {number}.")
    return decimal_text(number)


def read_source(path: Path, table_type: str) -> tuple[dict[tuple[str, str], dict[str, str]], list[str]]:
    """Read, filter and resolve one player/table export.

    Keys are (season, selected source team). If a season has a TOT/2TM/etc.
    aggregate, only that aggregate is selected. Multiple stints without an
    aggregate are rejected rather than combined.
    """

    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))

    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == "Season"),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: could not find a Season header.")
    header = [cell.strip() for cell in raw_rows[header_index]]
    if len(header) != len(set(header)):
        raise PreparationError(f"{path.name}: duplicate leaf headers are ambiguous.")
    missing = [column for column in REQUIRED_COLUMNS[table_type] if column not in header]
    if missing:
        raise PreparationError(f"{path.name}: missing required columns {missing}.")

    by_season: dict[str, list[dict[str, str]]] = defaultdict(list)
    excluded: list[str] = []
    for line_number, values in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        if len(values) != len(header):
            raise PreparationError(
                f"{path.name}:{line_number}: expected {len(header)} fields, found {len(values)}."
            )
        row = dict(zip(header, (cell.strip() for cell in values), strict=True))
        season = row["Season"]
        if season == "Season":
            excluded.append(f"{path.name}:{line_number} repeated header")
            continue
        if season in {"", "Career"}:
            excluded.append(f"{path.name}:{line_number} non-season summary")
            continue
        if season not in SEASONS:
            excluded.append(f"{path.name}:{line_number} season outside coverage ({season})")
            continue
        row["_source_row_id"] = f"{path.name}:{line_number}"
        by_season[season].append(row)

    selected: dict[tuple[str, str], dict[str, str]] = {}
    for season in SEASONS:
        candidates = by_season.get(season, [])
        if not candidates:
            raise PreparationError(f"{path.name}: missing required season {season}.")
        aggregates = [row for row in candidates if AGGREGATE_TEAM.fullmatch(row["Team"])]
        if len(aggregates) > 1:
            raise PreparationError(f"{path.name}: multiple aggregate rows for {season}.")
        if aggregates:
            chosen = aggregates[0]
            for row in candidates:
                if row is not chosen:
                    excluded.append(
                        f"{row['_source_row_id']} constituent stint excluded in favor of "
                        f"{chosen['_source_row_id']}"
                    )
        elif len(candidates) == 1:
            chosen = candidates[0]
        else:
            teams = ", ".join(row["Team"] for row in candidates)
            raise PreparationError(
                f"{path.name}: {season} has multiple stints ({teams}) without an aggregate; "
                "a season rate will not be invented."
            )
        key = (season, chosen["Team"])
        if key in selected:
            raise PreparationError(f"{path.name}: duplicate selected identity {key}.")
        selected[key] = chosen

    if len(selected) != len(SEASONS):
        raise PreparationError(f"{path.name}: expected five selected season rows.")
    return selected, excluded


def validate_common(player: str, season: str, rows: dict[str, dict[str, str]]) -> None:
    for column in ("Age", "Team", "Lg", "G", "GS"):
        values = {table: row[column] for table, row in rows.items()}
        if len(set(values.values())) != 1:
            raise PreparationError(f"{player} {season}: {column} conflicts across sources: {values}.")
    if rows["p100"]["MP"] != rows["adv"]["MP"]:
        raise PreparationError(
            f"{player} {season}: total minutes conflict between P100P and Adv."
        )
    for column in ("FG%", "3P%", "FT%", "eFG%"):
        if rows["avg"][column] != rows["p100"][column]:
            raise PreparationError(
                f"{player} {season}: {column} conflict between Avg and P100P."
            )

    games = integer_value(rows["avg"]["G"], location=f"{player} {season} G")
    starts = integer_value(rows["avg"]["GS"], location=f"{player} {season} GS")
    total_minutes = decimal_value(rows["p100"]["MP"], location=f"{player} {season} total MP")
    minutes_per_game = decimal_value(rows["avg"]["MP"], location=f"{player} {season} MPG")
    assert total_minutes is not None and minutes_per_game is not None
    if games < 0 or starts < 0 or starts > games or games > 82:
        raise PreparationError(
            f"{player} {season}: invalid games/starts combination G={games}, GS={starts}."
        )
    if games == 0 or abs(total_minutes / games - minutes_per_game) > MPG_ROUNDING_TOLERANCE:
        raise PreparationError(
            f"{player} {season}: total minutes / G does not match Avg MPG within "
            f"{MPG_ROUNDING_TOLERANCE}."
        )
    if rows["avg"]["Lg"] != LEAGUE:
        raise PreparationError(f"{player} {season}: unexpected league {rows['avg']['Lg']!r}.")


def prepare(raw_dir: Path) -> tuple[list[dict[str, str]], list[str]]:
    tables: dict[str, dict[str, dict[tuple[str, str], dict[str, str]]]] = defaultdict(dict)
    excluded: list[str] = []
    player_names: dict[str, str] = {}

    for filename, (player_id, player_name, table_type) in FILE_PLAYER_MAP.items():
        selected, source_excluded = read_source(raw_dir / filename, table_type)
        tables[player_id][table_type] = selected
        player_names[player_id] = player_name
        excluded.extend(source_excluded)

    output: list[dict[str, str]] = []
    player_order = ("jaylen_brown", "jayson_tatum", "paul_george")
    for player_id in player_order:
        player_tables = tables[player_id]
        if set(player_tables) != {"avg", "p100", "adv"}:
            raise PreparationError(f"{player_id}: incomplete table set {sorted(player_tables)}.")
        key_sets = {table: set(rows) for table, rows in player_tables.items()}
        if len({frozenset(keys) for keys in key_sets.values()}) != 1:
            raise PreparationError(f"{player_id}: unmatched one-to-one join keys {key_sets}.")

        for season in SEASONS:
            matching_keys = [key for key in key_sets["avg"] if key[0] == season]
            if len(matching_keys) != 1:
                raise PreparationError(
                    f"{player_id} {season}: expected one selected source-team key, found {matching_keys}."
                )
            key = matching_keys[0]
            source_team = key[1]
            rows = {table: player_tables[table][key] for table in ("avg", "p100", "adv")}
            validate_common(player_names[player_id], season, rows)
            avg, p100, adv = rows["avg"], rows["p100"], rows["adv"]

            location = f"{player_names[player_id]} {season}"
            record = {
                "player_id": player_id,
                "player_name": player_names[player_id],
                "season": season,
                "season_start": season[:4],
                "season_age": str(integer_value(avg["Age"], location=f"{location} Age")),
                "source_team": source_team,
                "league": avg["Lg"],
                "position": avg["Pos"],
                "games": str(integer_value(avg["G"], location=f"{location} G")),
                "starts": str(integer_value(avg["GS"], location=f"{location} GS")),
                "minutes_per_game": decimal_text(decimal_value(avg["MP"], location=f"{location} Avg MP")),
                "total_minutes": decimal_text(decimal_value(p100["MP"], location=f"{location} P100P MP")),
                "points_per_game": decimal_text(decimal_value(avg["PTS"], location=f"{location} Avg PTS")),
                "rebounds_per_game": decimal_text(decimal_value(avg["TRB"], location=f"{location} Avg TRB")),
                "assists_per_game": decimal_text(decimal_value(avg["AST"], location=f"{location} Avg AST")),
                "points_per_100": decimal_text(decimal_value(p100["PTS"], location=f"{location} P100P PTS")),
                "rebounds_per_100": decimal_text(decimal_value(p100["TRB"], location=f"{location} P100P TRB")),
                "assists_per_100": decimal_text(decimal_value(p100["AST"], location=f"{location} P100P AST")),
                "turnovers_per_100": decimal_text(decimal_value(p100["TOV"], location=f"{location} P100P TOV")),
                "fga_per_100": decimal_text(decimal_value(p100["FGA"], location=f"{location} P100P FGA")),
                "fta_per_100": decimal_text(decimal_value(p100["FTA"], location=f"{location} P100P FTA")),
                "fg3a_per_100": decimal_text(decimal_value(p100["3PA"], location=f"{location} P100P 3PA")),
                "fg_pct": fraction_text(avg["FG%"], location=f"{location} FG%"),
                "fg3_pct": fraction_text(avg["3P%"], location=f"{location} 3P%"),
                "ft_pct": fraction_text(avg["FT%"], location=f"{location} FT%"),
                "efg_pct": fraction_text(avg["eFG%"], location=f"{location} eFG%"),
                "ts_pct": fraction_text(adv["TS%"], location=f"{location} TS%"),
                "usage_pct": percentage_point_text(adv["USG%"], location=f"{location} USG%"),
                "assist_pct": percentage_point_text(adv["AST%"], location=f"{location} AST%"),
                "turnover_pct": percentage_point_text(adv["TOV%"], location=f"{location} TOV%"),
                "three_point_attempt_rate": fraction_text(adv["3PAr"], location=f"{location} 3PAr"),
                "free_throw_attempt_rate": fraction_text(adv["FTr"], location=f"{location} FTr"),
                "offensive_rebound_pct": percentage_point_text(adv["ORB%"], location=f"{location} ORB%"),
                "defensive_rebound_pct": percentage_point_text(adv["DRB%"], location=f"{location} DRB%"),
                "total_rebound_pct": percentage_point_text(adv["TRB%"], location=f"{location} TRB%"),
                "steal_pct": percentage_point_text(adv["STL%"], location=f"{location} STL%"),
                "block_pct": percentage_point_text(adv["BLK%"], location=f"{location} BLK%"),
                "avg_source_file": avg["_source_row_id"].split(":", 1)[0],
                "avg_source_row_id": avg["_source_row_id"],
                "p100_source_file": p100["_source_row_id"].split(":", 1)[0],
                "p100_source_row_id": p100["_source_row_id"],
                "adv_source_file": adv["_source_row_id"].split(":", 1)[0],
                "adv_source_row_id": adv["_source_row_id"],
            }
            if set(record) != set(OUTPUT_COLUMNS):
                raise PreparationError(f"{location}: normalized schema mismatch.")
            output.append(record)

    validate_output(output)
    return output, excluded


def validate_output(rows: list[dict[str, str]]) -> None:
    if len(rows) != 15:
        raise PreparationError(f"Expected exactly 15 normalized rows, found {len(rows)}.")
    identities = {(row["player_id"], row["season"]) for row in rows}
    if len(identities) != 15:
        raise PreparationError("Normalized player-season identities are not unique.")
    for player_id in {row["player_id"] for row in rows}:
        seasons = tuple(row["season"] for row in rows if row["player_id"] == player_id)
        if seasons != SEASONS:
            raise PreparationError(f"{player_id}: expected consecutive seasons {SEASONS}, found {seasons}.")

    required_numeric = OUTPUT_COLUMNS[8:37]
    for row in rows:
        for field in required_numeric:
            try:
                value = float(row[field])
            except ValueError as error:
                raise PreparationError(
                    f"{row['player_name']} {row['season']}: missing/invalid {field}."
                ) from error
            if not math.isfinite(value):
                raise PreparationError(
                    f"{row['player_name']} {row['season']}: non-finite {field}."
                )

    checks = {
        ("jaylen_brown", "2025-26"): (71, 42.2, 7.5, 0.573, 36.2),
        ("jayson_tatum", "2025-26"): (16, 33.7, 8.2, 0.541, 30.0),
        ("paul_george", "2025-26"): (37, 27.3, 5.7, 0.570, 23.3),
    }
    by_identity = {(row["player_id"], row["season"]): row for row in rows}
    for identity, expected in checks.items():
        row = by_identity[identity]
        actual = (
            int(row["games"]),
            float(row["points_per_100"]),
            float(row["assists_per_100"]),
            float(row["ts_pct"]),
            float(row["usage_pct"]),
        )
        if actual != expected:
            raise PreparationError(f"Supplied-file check failed for {identity}: {actual} != {expected}.")
    george_phi_games = sum(
        int(row["games"])
        for row in rows
        if row["player_id"] == "paul_george" and row["source_team"] == "PHI"
    )
    if george_phi_games != 78:
        raise PreparationError(f"Expected 78 Paul George PHI games, found {george_phi_games}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/celtics-wing-comparison-2021-2026.csv"),
    )
    args = parser.parse_args()
    rows, excluded = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} validated player-seasons to {args.output}")
    print("Validated one selected team row per player-season-table and one-to-one joins.")
    print(f"Excluded {len(excluded)} header, summary, out-of-window, or constituent rows.")


if __name__ == "__main__":
    main()
