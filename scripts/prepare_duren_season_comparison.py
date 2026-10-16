"""Normalize Jalen Duren regular-season and postseason player tables.

The six inputs are supplied Per Game, Per 100 Possessions and Advanced
exports. Player identity and season type come from the explicit filename map;
neither is inferred from row position.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYER_ID = "jalen_duren"
PLAYER_NAME = "Jalen Duren"
LEAGUE = "NBA"
TEAM = "DET"
REGULAR_SEASONS = ("2022-23", "2023-24", "2024-25", "2025-26")
POSTSEASONS = ("2024-25", "2025-26")
MPG_ROUNDING_TOLERANCE = Decimal("0.051")
AGGREGATE_TEAM = re.compile(r"^(?:TOT|\d+TM)$")

FILE_MAP = {
    "DurenRegSeasonPerGame.csv": ("regular_season", "per_game"),
    "DurenRegSeasonP100P.csv": ("regular_season", "p100"),
    "DurenRegSeasonAdv.csv": ("regular_season", "advanced"),
    "DurenPlayoffsPerGame.csv": ("playoffs", "per_game"),
    "DurenPlayoffsP100P.csv": ("playoffs", "p100"),
    "DurenPlayoffsAdv.csv": ("playoffs", "advanced"),
}

COMMON_COLUMNS = ("Season", "Age", "Team", "Lg", "G", "GS", "MP")
REQUIRED_COLUMNS = {
    "per_game": COMMON_COLUMNS + ("PTS", "TRB", "AST"),
    "p100": COMMON_COLUMNS + ("PTS", "TRB", "AST", "FGA", "TOV"),
    "advanced": COMMON_COLUMNS + ("TS%", "USG%", "TRB%", "TOV%", "ORB%", "DRB%"),
}

OUTPUT_COLUMNS = (
    "player_id",
    "player_name",
    "season",
    "season_start",
    "season_type",
    "source_team",
    "season_age",
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
    "fga_per_100",
    "turnovers_per_100",
    "ts_pct",
    "usage_pct",
    "total_rebound_pct",
    "turnover_pct",
    "offensive_rebound_pct",
    "defensive_rebound_pct",
    "per_game_source_file",
    "per_game_source_row_id",
    "p100_source_file",
    "p100_source_row_id",
    "advanced_source_file",
    "advanced_source_row_id",
)


class PreparationError(RuntimeError):
    """A clear validation error caused by source data or configuration."""


def decimal_value(value: str, *, location: str) -> Decimal:
    stripped = value.strip()
    if not stripped:
        raise PreparationError(f"Missing numeric value at {location}.")
    try:
        number = Decimal(stripped)
    except InvalidOperation as error:
        raise PreparationError(f"Invalid numeric value at {location}: {value!r}.") from error
    if not number.is_finite():
        raise PreparationError(f"Non-finite numeric value at {location}: {value!r}.")
    return number


def integer_value(value: str, *, location: str) -> int:
    number = decimal_value(value, location=location)
    if number != number.to_integral_value():
        raise PreparationError(f"Expected an integer at {location}, found {value!r}.")
    return int(number)


def decimal_text(value: Decimal) -> str:
    return format(value, "f")


def fraction_text(value: str, *, location: str) -> str:
    number = decimal_value(value, location=location)
    if not Decimal("0") <= number <= Decimal("1"):
        raise PreparationError(f"Fraction outside [0, 1] at {location}: {number}.")
    return decimal_text(number)


def percentage_point_text(value: str, *, location: str) -> str:
    number = decimal_value(value, location=location)
    if not Decimal("0") <= number <= Decimal("100"):
        raise PreparationError(f"Percentage outside [0, 100] at {location}: {number}.")
    return decimal_text(number)


def read_source(
    path: Path, table_type: str, season_type: str
) -> tuple[dict[tuple[str, str, str, str, str], dict[str, str]], list[str]]:
    """Read and resolve one source to one row per explicit join key.

    If a season contains an aggregate (TOT/2TM/etc.), that row is selected and
    its constituent stints are excluded. Multiple stints without an aggregate
    are rejected rather than added or averaged.
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
        raise PreparationError(f"{path.name}: duplicate headers are ambiguous.")
    missing = [column for column in REQUIRED_COLUMNS[table_type] if column not in header]
    if missing:
        raise PreparationError(f"{path.name}: missing required columns {missing}.")

    expected_seasons = REGULAR_SEASONS if season_type == "regular_season" else POSTSEASONS
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
        if season not in expected_seasons:
            excluded.append(f"{path.name}:{line_number} season outside coverage ({season})")
            continue
        row["_source_row_id"] = f"{path.name}:{line_number}"
        by_season[season].append(row)

    selected: dict[tuple[str, str, str, str, str], dict[str, str]] = {}
    for season in expected_seasons:
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
        key = (PLAYER_ID, PLAYER_NAME, season, season_type, chosen["Team"])
        if key in selected:
            raise PreparationError(f"{path.name}: duplicate selected identity {key}.")
        selected[key] = chosen

    if len(selected) != len(expected_seasons):
        raise PreparationError(f"{path.name}: unexpected selected-row count.")
    return selected, excluded


def validate_common(
    key: tuple[str, str, str, str, str], rows: dict[str, dict[str, str]]
) -> None:
    _, _, season, season_type, source_team = key
    location = f"{PLAYER_NAME} {season} {season_type}"
    for column in ("Age", "Team", "Lg", "G", "GS"):
        values = {table: row[column] for table, row in rows.items()}
        if len(set(values.values())) != 1:
            raise PreparationError(f"{location}: {column} conflicts across sources: {values}.")
    if source_team != rows["per_game"]["Team"]:
        raise PreparationError(f"{location}: selected team disagrees with explicit join key.")
    if rows["p100"]["MP"] != rows["advanced"]["MP"]:
        raise PreparationError(f"{location}: P100P and Advanced total minutes disagree.")
    if rows["per_game"]["Lg"] != LEAGUE:
        raise PreparationError(f"{location}: unexpected league {rows['per_game']['Lg']!r}.")
    if source_team != TEAM:
        raise PreparationError(f"{location}: unexpected source team {source_team!r}.")

    games = integer_value(rows["per_game"]["G"], location=f"{location} G")
    starts = integer_value(rows["per_game"]["GS"], location=f"{location} GS")
    total_minutes = decimal_value(rows["p100"]["MP"], location=f"{location} total MP")
    minutes_per_game = decimal_value(rows["per_game"]["MP"], location=f"{location} MPG")
    if games <= 0 or starts < 0 or starts > games:
        raise PreparationError(f"{location}: invalid G/GS combination {games}/{starts}.")
    if abs(total_minutes / games - minutes_per_game) > MPG_ROUNDING_TOLERANCE:
        raise PreparationError(
            f"{location}: total minutes / G does not match MPG within "
            f"{MPG_ROUNDING_TOLERANCE}."
        )


def prepare(raw_dir: Path) -> tuple[list[dict[str, str]], list[str]]:
    tables: dict[str, dict[str, dict[tuple[str, str, str, str, str], dict[str, str]]]] = defaultdict(dict)
    excluded: list[str] = []
    for filename, (season_type, table_type) in FILE_MAP.items():
        selected, source_excluded = read_source(raw_dir / filename, table_type, season_type)
        tables[season_type][table_type] = selected
        excluded.extend(source_excluded)

    output: list[dict[str, str]] = []
    for season_type, seasons in (("regular_season", REGULAR_SEASONS), ("playoffs", POSTSEASONS)):
        typed_tables = tables[season_type]
        if set(typed_tables) != {"per_game", "p100", "advanced"}:
            raise PreparationError(f"{season_type}: incomplete table set {sorted(typed_tables)}.")
        key_sets = {table: set(rows) for table, rows in typed_tables.items()}
        if len({frozenset(keys) for keys in key_sets.values()}) != 1:
            raise PreparationError(f"{season_type}: unmatched one-to-one join keys {key_sets}.")

        for season in seasons:
            matches = [key for key in key_sets["per_game"] if key[2] == season]
            if len(matches) != 1:
                raise PreparationError(f"{season_type} {season}: expected one join key, found {matches}.")
            key = matches[0]
            rows = {table: typed_tables[table][key] for table in ("per_game", "p100", "advanced")}
            validate_common(key, rows)
            per_game, p100, advanced = rows["per_game"], rows["p100"], rows["advanced"]
            location = f"{PLAYER_NAME} {season} {season_type}"
            record = {
                "player_id": PLAYER_ID,
                "player_name": PLAYER_NAME,
                "season": season,
                "season_start": season[:4],
                "season_type": season_type,
                "source_team": key[4],
                "season_age": str(integer_value(per_game["Age"], location=f"{location} Age")),
                "games": str(integer_value(per_game["G"], location=f"{location} G")),
                "starts": str(integer_value(per_game["GS"], location=f"{location} GS")),
                "minutes_per_game": decimal_text(decimal_value(per_game["MP"], location=f"{location} MPG")),
                "total_minutes": decimal_text(decimal_value(p100["MP"], location=f"{location} total MP")),
                "points_per_game": decimal_text(decimal_value(per_game["PTS"], location=f"{location} PPG")),
                "rebounds_per_game": decimal_text(decimal_value(per_game["TRB"], location=f"{location} RPG")),
                "assists_per_game": decimal_text(decimal_value(per_game["AST"], location=f"{location} APG")),
                "points_per_100": decimal_text(decimal_value(p100["PTS"], location=f"{location} PTS/100")),
                "rebounds_per_100": decimal_text(decimal_value(p100["TRB"], location=f"{location} REB/100")),
                "assists_per_100": decimal_text(decimal_value(p100["AST"], location=f"{location} AST/100")),
                "fga_per_100": decimal_text(decimal_value(p100["FGA"], location=f"{location} FGA/100")),
                "turnovers_per_100": decimal_text(decimal_value(p100["TOV"], location=f"{location} TOV/100")),
                "ts_pct": fraction_text(advanced["TS%"], location=f"{location} TS%"),
                "usage_pct": percentage_point_text(advanced["USG%"], location=f"{location} USG%"),
                "total_rebound_pct": percentage_point_text(advanced["TRB%"], location=f"{location} TRB%"),
                "turnover_pct": percentage_point_text(advanced["TOV%"], location=f"{location} TOV%"),
                "offensive_rebound_pct": percentage_point_text(advanced["ORB%"], location=f"{location} ORB%"),
                "defensive_rebound_pct": percentage_point_text(advanced["DRB%"], location=f"{location} DRB%"),
                "per_game_source_file": per_game["_source_row_id"].split(":", 1)[0],
                "per_game_source_row_id": per_game["_source_row_id"],
                "p100_source_file": p100["_source_row_id"].split(":", 1)[0],
                "p100_source_row_id": p100["_source_row_id"],
                "advanced_source_file": advanced["_source_row_id"].split(":", 1)[0],
                "advanced_source_row_id": advanced["_source_row_id"],
            }
            if tuple(record) != OUTPUT_COLUMNS:
                raise PreparationError(f"{location}: normalized schema mismatch.")
            output.append(record)

    validate_output(output)
    return output, excluded


def validate_output(rows: list[dict[str, str]]) -> None:
    if len(rows) != 6:
        raise PreparationError(f"Expected six normalized rows, found {len(rows)}.")
    identities = {
        (row["player_id"], row["player_name"], row["season"], row["season_type"], row["source_team"])
        for row in rows
    }
    if len(identities) != 6:
        raise PreparationError("Normalized join identities are not unique.")
    coverage = [(row["season"], row["season_type"]) for row in rows]
    expected = [(season, "regular_season") for season in REGULAR_SEASONS] + [
        (season, "playoffs") for season in POSTSEASONS
    ]
    if coverage != expected:
        raise PreparationError(f"Coverage mismatch: {coverage} != {expected}.")

    numeric_fields = (
        "season_start",
        "season_age",
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
        "fga_per_100",
        "turnovers_per_100",
        "ts_pct",
        "usage_pct",
        "total_rebound_pct",
        "turnover_pct",
        "offensive_rebound_pct",
        "defensive_rebound_pct",
    )
    for row in rows:
        for field in numeric_fields:
            try:
                value = float(row[field])
            except ValueError as error:
                raise PreparationError(f"{row['season']} {row['season_type']}: invalid {field}.") from error
            if not math.isfinite(value):
                raise PreparationError(f"{row['season']} {row['season_type']}: non-finite {field}.")

    expected_chart = {
        ("2024-25", "regular_season"): (21.7, 0.703, 22.0, 17.2, 16.4, 78, 2034),
        ("2024-25", "playoffs"): (17.3, 0.708, 18.1, 16.6, 12.8, 6, 203),
        ("2025-26", "regular_season"): (33.4, 0.688, 20.9, 11.6, 23.6, 70, 1976),
        ("2025-26", "playoffs"): (17.3, 0.553, 16.1, 19.8, 16.7, 14, 422),
    }
    by_identity = {(row["season"], row["season_type"]): row for row in rows}
    for identity, expected_values in expected_chart.items():
        row = by_identity[identity]
        actual = (
            float(row["points_per_100"]),
            float(row["ts_pct"]),
            float(row["total_rebound_pct"]),
            float(row["turnover_pct"]),
            float(row["usage_pct"]),
            int(row["games"]),
            int(row["total_minutes"]),
        )
        if actual != expected_values:
            raise PreparationError(f"Raw-value check failed for {identity}: {actual} != {expected_values}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/duren-season-comparison-2022-2026.csv"),
    )
    args = parser.parse_args()
    rows, excluded = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} validated player-season-season_type rows to {args.output}")
    print("Validated explicit five-part join keys, unique rows, metadata, units, and source values.")
    print(f"Excluded {len(excluded)} repeated-header, summary, out-of-window, or constituent rows.")


if __name__ == "__main__":
    main()
