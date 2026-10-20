"""Prepare Darius Garland's five-season availability and production data.

The supplied Basketball Reference-style exports contain regular-season Per
Game, Per 100 Possessions and Advanced rows. The script keeps one full-season
record per season, preferring an existing TOT/2TM/3TM aggregate to individual
team stints, and never sums or averages advanced rates.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYER_ID = "garlada01"
PLAYER_NAME = "Darius Garland"
SEASONS = ("2021-22", "2022-23", "2023-24", "2024-25", "2025-26")
SCHEDULED_GAMES = {season: 82 for season in SEASONS}
AGGREGATE_TEAM = re.compile(r"^(?:TOT|\d+TM)$")
MPG_ROUNDING_TOLERANCE = Decimal("0.051")

FILES = {
    "per_game": "GarlandPerGame.csv",
    "p100": "GarlandP100P.csv",
    "advanced": "GarlandAdv.csv",
}

COMMON_COLUMNS = ("Season", "Age", "Team", "Lg", "Pos", "G", "GS", "MP")
REQUIRED_COLUMNS = {
    "per_game": COMMON_COLUMNS + ("PTS", "AST"),
    "p100": COMMON_COLUMNS + ("PTS", "AST"),
    "advanced": COMMON_COLUMNS + ("TS%",),
}

OUTPUT_COLUMNS = (
    "player_id",
    "player_name",
    "season",
    "season_start",
    "season_type",
    "source_team",
    "team_stints",
    "is_combined_total",
    "season_age",
    "games",
    "scheduled_games_reference",
    "games_not_played",
    "starts",
    "minutes_per_game",
    "total_minutes",
    "points_per_game",
    "assists_per_game",
    "points_per_100",
    "assists_per_100",
    "ts_pct",
    "per_game_source_row_id",
    "p100_source_row_id",
    "advanced_source_row_id",
)


class PreparationError(RuntimeError):
    """Raised when a source or validation rule prevents a truthful output."""


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


def read_source(path: Path, table_type: str) -> tuple[dict[str, dict[str, str]], list[str]]:
    """Return one selected row per season plus an exclusion audit."""

    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))

    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == "Season"),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: no Season header found.")
    header = [cell.strip() for cell in raw_rows[header_index]]
    if len(header) != len(set(header)):
        raise PreparationError(f"{path.name}: duplicate headers are ambiguous.")
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
        row_id = f"{path.name}:line-{line_number}"
        if season == "Season":
            excluded.append(f"{row_id} repeated header")
            continue
        if season in {"", "Career"}:
            excluded.append(f"{row_id} non-season summary")
            continue
        if season not in SEASONS:
            excluded.append(f"{row_id} season outside 2021-22 through 2025-26 ({season})")
            continue
        row["_source_row_id"] = row_id
        by_season[season].append(row)

    selected: dict[str, dict[str, str]] = {}
    for season in SEASONS:
        candidates = by_season.get(season, [])
        if not candidates:
            raise PreparationError(f"{path.name}: missing required season {season}.")
        aggregates = [row for row in candidates if AGGREGATE_TEAM.fullmatch(row["Team"])]
        if len(aggregates) > 1:
            raise PreparationError(f"{path.name}: multiple combined rows for {season}.")
        if aggregates:
            chosen = aggregates[0]
            for row in candidates:
                if row is not chosen:
                    excluded.append(
                        f"{row['_source_row_id']} stint excluded in favor of {chosen['_source_row_id']}"
                    )
        elif len(candidates) == 1:
            chosen = candidates[0]
        else:
            teams = ", ".join(row["Team"] for row in candidates)
            raise PreparationError(
                f"{path.name}: {season} has multiple stints ({teams}) without a combined row; "
                "rates will not be summed or averaged."
            )
        selected[season] = chosen

    if len(selected) != len(SEASONS):
        raise PreparationError(f"{path.name}: expected {len(SEASONS)} selected rows.")
    return selected, excluded


def validate_common(season: str, rows: dict[str, dict[str, str]]) -> None:
    location = f"{PLAYER_NAME} {season} regular season"
    for column in ("Age", "Team", "Lg", "Pos", "G", "GS"):
        values = {table: row[column] for table, row in rows.items()}
        if len(set(values.values())) != 1:
            raise PreparationError(f"{location}: {column} conflicts across sources: {values}.")
    if rows["per_game"]["Lg"] != "NBA":
        raise PreparationError(f"{location}: expected NBA league row.")
    if rows["p100"]["MP"] != rows["advanced"]["MP"]:
        raise PreparationError(f"{location}: Per 100 and Advanced total minutes disagree.")

    games = integer_value(rows["per_game"]["G"], location=f"{location} G")
    starts = integer_value(rows["per_game"]["GS"], location=f"{location} GS")
    total_minutes = decimal_value(rows["p100"]["MP"], location=f"{location} total MP")
    mpg = decimal_value(rows["per_game"]["MP"], location=f"{location} MPG")
    if games <= 0 or starts < 0 or starts > games:
        raise PreparationError(f"{location}: invalid G/GS combination {games}/{starts}.")
    if games > SCHEDULED_GAMES[season]:
        raise PreparationError(f"{location}: games exceed the 82-game reference.")
    if abs(total_minutes / games - mpg) > MPG_ROUNDING_TOLERANCE:
        raise PreparationError(f"{location}: total minutes / games does not match MPG.")


def prepare(raw_dir: Path) -> tuple[list[dict[str, str]], list[str]]:
    tables: dict[str, dict[str, dict[str, str]]] = {}
    excluded: list[str] = []
    for table_type, filename in FILES.items():
        tables[table_type], audit = read_source(raw_dir / filename, table_type)
        excluded.extend(audit)

    key_sets = {table: set(rows) for table, rows in tables.items()}
    if len({frozenset(keys) for keys in key_sets.values()}) != 1:
        raise PreparationError(f"The three sources do not have identical season keys: {key_sets}.")

    output: list[dict[str, str]] = []
    for season in SEASONS:
        rows = {table: tables[table][season] for table in FILES}
        validate_common(season, rows)
        per_game, p100, advanced = rows["per_game"], rows["p100"], rows["advanced"]
        location = f"{PLAYER_NAME} {season} regular season"
        games = integer_value(per_game["G"], location=f"{location} G")
        ts_pct = decimal_value(advanced["TS%"], location=f"{location} TS%")
        if not Decimal("0") <= ts_pct <= Decimal("1"):
            raise PreparationError(f"{location}: TS% is outside [0, 1].")
        source_team = per_game["Team"]
        record = {
            "player_id": PLAYER_ID,
            "player_name": PLAYER_NAME,
            "season": season,
            "season_start": season[:4],
            "season_type": "regular_season",
            "source_team": source_team,
            "team_stints": "",
            "is_combined_total": str(bool(AGGREGATE_TEAM.fullmatch(source_team))).lower(),
            "season_age": str(integer_value(per_game["Age"], location=f"{location} Age")),
            "games": str(games),
            "scheduled_games_reference": str(SCHEDULED_GAMES[season]),
            "games_not_played": str(SCHEDULED_GAMES[season] - games),
            "starts": str(integer_value(per_game["GS"], location=f"{location} GS")),
            "minutes_per_game": decimal_text(decimal_value(per_game["MP"], location=f"{location} MPG")),
            "total_minutes": decimal_text(decimal_value(p100["MP"], location=f"{location} total MP")),
            "points_per_game": decimal_text(decimal_value(per_game["PTS"], location=f"{location} PPG")),
            "assists_per_game": decimal_text(decimal_value(per_game["AST"], location=f"{location} APG")),
            "points_per_100": decimal_text(decimal_value(p100["PTS"], location=f"{location} PTS/100")),
            "assists_per_100": decimal_text(decimal_value(p100["AST"], location=f"{location} AST/100")),
            "ts_pct": decimal_text(ts_pct),
            "per_game_source_row_id": per_game["_source_row_id"],
            "p100_source_row_id": p100["_source_row_id"],
            "advanced_source_row_id": advanced["_source_row_id"],
        }
        if tuple(record) != OUTPUT_COLUMNS:
            raise PreparationError(f"{location}: output schema mismatch.")
        output.append(record)

    validate_output(output)
    return output, excluded


def validate_output(rows: list[dict[str, str]]) -> None:
    if len(rows) != 5:
        raise PreparationError(f"Expected five records, found {len(rows)}.")
    identities = {(row["player_id"], row["season"], row["season_type"]) for row in rows}
    if len(identities) != 5:
        raise PreparationError("The output would multiply a player-season join.")
    if [row["season"] for row in rows] != list(SEASONS):
        raise PreparationError("Output coverage is incomplete or out of order.")

    expected = {
        "2021-22": (68, 14, 35.7, 30.3, 12.0, 0.576, "CLE", False),
        "2022-23": (69, 13, 35.5, 30.5, 11.0, 0.587, "CLE", False),
        "2023-24": (57, 25, 33.4, 26.7, 9.7, 0.560, "CLE", False),
        "2024-25": (75, 7, 30.7, 32.3, 10.6, 0.600, "CLE", False),
        "2025-26": (45, 37, 29.9, 30.6, 10.9, 0.582, "2TM", True),
    }
    for row in rows:
        actual = (
            int(row["games"]),
            int(row["games_not_played"]),
            float(row["minutes_per_game"]),
            float(row["points_per_100"]),
            float(row["assists_per_100"]),
            float(row["ts_pct"]),
            row["source_team"],
            row["is_combined_total"] == "true",
        )
        if actual != expected[row["season"]]:
            raise PreparationError(f"Source-value spot check failed for {row['season']}: {actual}.")
        for field in ("minutes_per_game", "total_minutes", "points_per_100", "assists_per_100", "ts_pct"):
            if not math.isfinite(float(row[field])):
                raise PreparationError(f"{row['season']}: non-finite {field}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/garland-clippers-2021-2026.csv"),
    )
    args = parser.parse_args()
    rows, excluded = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} player-season records to {args.output}")
    print("PASS: one-to-one season joins, combined-row handling, minute units and source spot checks")
    print(f"Excluded {len(excluded)} out-of-window, summary, repeated-header or constituent rows")


if __name__ == "__main__":
    main()
