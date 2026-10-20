"""Normalize Walker Kessler's supplied regular-season exports for the Lakers preview."""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYER_ID = "kesslwa01"
PLAYER_NAME = "Walker Kessler"
SOURCE_TEAM = "UTA"
LEAGUE = "NBA"
SEASONS = ("2022-23", "2023-24", "2024-25", "2025-26")
MPG_ROUNDING_TOLERANCE = Decimal("0.051")
FILES = {
    "per_game": "KesslerRegSeason_PerGame.csv",
    "per_100": "KesslerRegSeason_P100P.csv",
    "advanced": "KesslerRegSeason_Adv.csv",
}
COMMON_COLUMNS = ("Season", "Age", "Team", "Lg", "G", "GS", "MP")
REQUIRED_COLUMNS = {
    "per_game": COMMON_COLUMNS + ("FG%", "FT%", "eFG%", "PTS", "TRB", "BLK"),
    "per_100": COMMON_COLUMNS + ("PTS", "TRB", "BLK"),
    "advanced": COMMON_COLUMNS + ("ORB%", "DRB%", "TRB%", "BLK%", "TS%", "USG%", "TOV%"),
}
OUTPUT_COLUMNS = (
    "player_id",
    "player_name",
    "season",
    "season_start",
    "source_team",
    "season_age",
    "games",
    "starts",
    "minutes_per_game",
    "total_minutes",
    "points_per_game",
    "rebounds_per_game",
    "blocks_per_game",
    "points_per_100",
    "rebounds_per_100",
    "blocks_per_100",
    "offensive_rebound_pct",
    "defensive_rebound_pct",
    "total_rebound_pct",
    "block_pct",
    "ts_pct",
    "usage_pct",
    "turnover_pct",
    "per_game_source_filename",
    "per_game_original_row_identifier",
    "per_100_source_filename",
    "per_100_original_row_identifier",
    "advanced_source_filename",
    "advanced_original_row_identifier",
)


class PreparationError(RuntimeError):
    """Raised when a supplied source cannot be normalized without guessing."""


@dataclass(frozen=True)
class SourceRow:
    values: dict[str, str]
    filename: str
    line_number: int

    @property
    def row_identifier(self) -> str:
        return f"{self.filename}:line-{self.line_number}"


def decimal_value(value: str, *, location: str, allow_missing: bool = False) -> Decimal | None:
    stripped = value.strip()
    if not stripped:
        if allow_missing:
            return None
        raise PreparationError(f"Missing numeric value at {location}.")
    try:
        number = Decimal(stripped)
    except InvalidOperation as error:
        raise PreparationError(f"Invalid numeric value at {location}: {value!r}.") from error
    if not number.is_finite():
        raise PreparationError(f"Non-finite numeric value at {location}: {value!r}.")
    return number


def decimal_text(value: str, *, location: str, allow_missing: bool = False) -> str:
    number = decimal_value(value, location=location, allow_missing=allow_missing)
    return "" if number is None else format(number, "f")


def integer_text(value: str, *, location: str) -> str:
    number = decimal_value(value, location=location)
    assert number is not None
    if number != number.to_integral_value():
        raise PreparationError(f"Expected an integer at {location}, found {value!r}.")
    return str(int(number))


def fraction_text(value: str, *, location: str, allow_missing: bool = False) -> str:
    number = decimal_value(value, location=location, allow_missing=allow_missing)
    if number is None:
        return ""
    if not Decimal("0") <= number <= Decimal("1"):
        raise PreparationError(f"Fraction outside [0, 1] at {location}: {number}.")
    return format(number, "f")


def percentage_point_text(value: str, *, location: str, allow_missing: bool = False) -> str:
    number = decimal_value(value, location=location, allow_missing=allow_missing)
    if number is None:
        return ""
    if not Decimal("0") <= number <= Decimal("100"):
        raise PreparationError(f"Percentage outside [0, 100] at {location}: {number}.")
    return format(number, "f")


def read_source(path: Path, table_type: str) -> dict[tuple[str, str, str], SourceRow]:
    """Return one source row per explicit player-season-team key.

    Blank rows, repeated headers and Career/Season summaries are removed. Any
    duplicate real row is rejected before the three tables are joined.
    """

    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))

    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == "Season"),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: could not find the Season header.")
    header = [cell.strip() for cell in raw_rows[header_index]]
    if len(header) != len(set(header)):
        raise PreparationError(f"{path.name}: duplicate column names are ambiguous.")
    missing_columns = [column for column in REQUIRED_COLUMNS[table_type] if column not in header]
    if missing_columns:
        raise PreparationError(f"{path.name}: missing required columns {missing_columns}.")

    indexed: dict[tuple[str, str, str], SourceRow] = {}
    for line_number, cells in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not cells or not any(cell.strip() for cell in cells):
            continue
        if len(cells) != len(header):
            raise PreparationError(
                f"{path.name}:{line_number}: expected {len(header)} fields, found {len(cells)}."
            )
        values = dict(zip(header, (cell.strip() for cell in cells), strict=True))
        if values["Season"] in {"", "Season", "Career"}:
            continue
        if values["Season"] not in SEASONS:
            raise PreparationError(
                f"{path.name}:{line_number}: unexpected season {values['Season']!r}; "
                f"expected exactly {', '.join(SEASONS)}."
            )
        key = (PLAYER_ID, values["Season"], values["Team"])
        if key in indexed:
            raise PreparationError(
                f"{path.name}: duplicate explicit player-season-team key {key} at "
                f"{indexed[key].row_identifier} and line {line_number}."
            )
        indexed[key] = SourceRow(values, path.name, line_number)

    expected_keys = {(PLAYER_ID, season, SOURCE_TEAM) for season in SEASONS}
    if set(indexed) != expected_keys:
        missing = sorted(expected_keys - set(indexed))
        extra = sorted(set(indexed) - expected_keys)
        raise PreparationError(f"{path.name}: coverage mismatch; missing={missing}, extra={extra}.")
    return indexed


def validate_shared_metadata(key: tuple[str, str, str], rows: dict[str, SourceRow]) -> None:
    _, season, source_team = key
    location = f"{PLAYER_NAME} {season} {source_team}"
    for column in ("Age", "Team", "Lg", "G", "GS"):
        values = {table: row.values[column] for table, row in rows.items()}
        if len(set(values.values())) != 1:
            raise PreparationError(f"{location}: {column} conflicts across sources: {values}.")
    if rows["per_100"].values["MP"] != rows["advanced"].values["MP"]:
        raise PreparationError(f"{location}: P100P and Advanced total minutes disagree.")
    if rows["per_game"].values["Team"] != SOURCE_TEAM:
        raise PreparationError(f"{location}: expected source team {SOURCE_TEAM}.")
    if rows["per_game"].values["Lg"] != LEAGUE:
        raise PreparationError(f"{location}: unexpected league {rows['per_game'].values['Lg']!r}.")

    games = decimal_value(rows["per_game"].values["G"], location=f"{location} games")
    starts = decimal_value(rows["per_game"].values["GS"], location=f"{location} starts")
    total_minutes = decimal_value(rows["per_100"].values["MP"], location=f"{location} total minutes")
    minutes_per_game = decimal_value(rows["per_game"].values["MP"], location=f"{location} MPG")
    assert games is not None and starts is not None and total_minutes is not None and minutes_per_game is not None
    if games <= 0 or starts < 0 or starts > games:
        raise PreparationError(f"{location}: invalid G/GS combination {games}/{starts}.")
    if abs(total_minutes / games - minutes_per_game) > MPG_ROUNDING_TOLERANCE:
        raise PreparationError(
            f"{location}: total minutes/G does not agree with MPG within "
            f"{MPG_ROUNDING_TOLERANCE}."
        )


def prepare(raw_dir: Path) -> list[dict[str, str]]:
    tables = {
        table_type: read_source(raw_dir / filename, table_type)
        for table_type, filename in FILES.items()
    }
    key_sets = {table_type: set(rows) for table_type, rows in tables.items()}
    if len({frozenset(keys) for keys in key_sets.values()}) != 1:
        union = set().union(*key_sets.values())
        differences = {table: sorted(union - keys) for table, keys in key_sets.items()}
        raise PreparationError(f"Incomplete one-to-one join: {differences}.")

    output: list[dict[str, str]] = []
    for season in SEASONS:
        key = (PLAYER_ID, season, SOURCE_TEAM)
        rows = {table: tables[table][key] for table in ("per_game", "per_100", "advanced")}
        validate_shared_metadata(key, rows)
        per_game = rows["per_game"]
        per_100 = rows["per_100"]
        advanced = rows["advanced"]
        location = f"{PLAYER_NAME} {season}"

        record = {
            "player_id": PLAYER_ID,
            "player_name": PLAYER_NAME,
            "season": season,
            "season_start": season[:4],
            "source_team": SOURCE_TEAM,
            "season_age": integer_text(per_game.values["Age"], location=f"{location} Age"),
            "games": integer_text(per_game.values["G"], location=f"{location} G"),
            "starts": integer_text(per_game.values["GS"], location=f"{location} GS"),
            "minutes_per_game": decimal_text(per_game.values["MP"], location=f"{location} MPG"),
            "total_minutes": decimal_text(per_100.values["MP"], location=f"{location} total MP"),
            "points_per_game": decimal_text(per_game.values["PTS"], location=f"{location} PPG", allow_missing=True),
            "rebounds_per_game": decimal_text(per_game.values["TRB"], location=f"{location} RPG", allow_missing=True),
            "blocks_per_game": decimal_text(per_game.values["BLK"], location=f"{location} BPG", allow_missing=True),
            "points_per_100": decimal_text(per_100.values["PTS"], location=f"{location} PTS/100", allow_missing=True),
            "rebounds_per_100": decimal_text(per_100.values["TRB"], location=f"{location} REB/100", allow_missing=True),
            "blocks_per_100": decimal_text(per_100.values["BLK"], location=f"{location} BLK/100", allow_missing=True),
            "offensive_rebound_pct": percentage_point_text(advanced.values["ORB%"], location=f"{location} ORB%", allow_missing=True),
            "defensive_rebound_pct": percentage_point_text(advanced.values["DRB%"], location=f"{location} DRB%", allow_missing=True),
            "total_rebound_pct": percentage_point_text(advanced.values["TRB%"], location=f"{location} TRB%", allow_missing=True),
            "block_pct": percentage_point_text(advanced.values["BLK%"], location=f"{location} BLK%", allow_missing=True),
            "ts_pct": fraction_text(advanced.values["TS%"], location=f"{location} TS%", allow_missing=True),
            "usage_pct": percentage_point_text(advanced.values["USG%"], location=f"{location} USG%", allow_missing=True),
            "turnover_pct": percentage_point_text(advanced.values["TOV%"], location=f"{location} TOV%", allow_missing=True),
            "per_game_source_filename": per_game.filename,
            "per_game_original_row_identifier": per_game.row_identifier,
            "per_100_source_filename": per_100.filename,
            "per_100_original_row_identifier": per_100.row_identifier,
            "advanced_source_filename": advanced.filename,
            "advanced_original_row_identifier": advanced.row_identifier,
        }
        if tuple(record) != OUTPUT_COLUMNS:
            raise PreparationError(f"{location}: normalized schema mismatch.")
        output.append(record)

    validate_output(output)
    return output


def validate_output(rows: list[dict[str, str]]) -> None:
    if len(rows) != 4:
        raise PreparationError(f"Expected four normalized rows, found {len(rows)}.")
    keys = [(row["player_id"], row["season"], row["source_team"]) for row in rows]
    if len(keys) != len(set(keys)):
        raise PreparationError("Normalized output contains duplicate player-season-team keys.")
    if [row["season"] for row in rows] != list(SEASONS):
        raise PreparationError("Normalized output does not contain the four seasons in order.")

    required_numeric_fields = (
        "season_start",
        "season_age",
        "games",
        "starts",
        "minutes_per_game",
        "total_minutes",
        "rebounds_per_game",
        "blocks_per_game",
        "offensive_rebound_pct",
        "block_pct",
        "ts_pct",
    )
    for row in rows:
        for field in required_numeric_fields:
            try:
                value = float(row[field])
            except ValueError as error:
                raise PreparationError(f"{row['season']}: missing or invalid required {field}.") from error
            if not math.isfinite(value):
                raise PreparationError(f"{row['season']}: non-finite required {field}.")

    expected = {
        "2022-23": (74, 1703, 14.9, 8.6),
        "2023-24": (64, 1493, 12.3, 9.2),
        "2024-25": (58, 1740, 16.6, 7.4),
        "2025-26": (5, 154, 15.7, 5.6),
    }
    for row in rows:
        actual = (
            int(row["games"]),
            int(row["total_minutes"]),
            float(row["offensive_rebound_pct"]),
            float(row["block_pct"]),
        )
        if actual != expected[row["season"]]:
            raise PreparationError(
                f"{row['season']}: requested source-value check failed: {actual} != {expected[row['season']]}"
            )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/kessler-lakers-2022-2026.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} normalized player-season rows to {args.output}")
    print("PASS: explicit one-to-one player-season-team joins and unique source rows")
    print("PASS: Age, Team, G and GS agree; P100P/Advanced minutes agree; MPG rounding checks pass")
    print("PASS: four UTA seasons, finite chart/table values and requested source-value checks")


if __name__ == "__main__":
    main()
