"""Normalize the supplied Chet Holmgren season and shared-game exports.

The matchup inputs are aggregate per-game tables, not game logs.  This script
therefore preserves their distinct coverage windows and does not manufacture a
same-season "other opponents" group.
"""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYER_ID = "holmgch01"
PLAYER_NAME = "Chet Holmgren"
FILES = {
    "season": "Chet_RegSeason_PerGame.csv",
    "shared_regular": "ChetVsWemby_RegSeason_PerGame.csv",
    "shared_postseason": "ChetVsWemby_Postseason_PerGame.csv",
}
REQUIRED = {
    "season": ("Season", "Team", "G", "MP", "FGA", "FTA", "TRB", "PTS"),
    "shared_regular": ("Rk", "Player", "G", "MP", "FGA", "FTA", "TRB", "PTS", "Player-additional"),
    "shared_postseason": ("Rk", "Player", "G", "MP", "FGA", "FTA", "TRB", "PTS", "Player-additional"),
}
OUTPUT_COLUMNS = (
    "sample_id",
    "player_id",
    "player_name",
    "season_type",
    "coverage_label",
    "population_label",
    "comparison_status",
    "games",
    "minutes_per_game",
    "approx_total_minutes",
    "points_per_game",
    "field_goal_attempts_per_game",
    "free_throw_attempts_per_game",
    "rebounds_per_game",
    "points_per_36",
    "rebounds_per_36",
    "true_shooting_pct",
    "source_filename",
    "source_row_identifier",
    "values_reconstructed_from_rounded_per_game_averages",
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


def decimal_value(value: str, *, location: str) -> Decimal:
    try:
        number = Decimal(value.strip())
    except (InvalidOperation, AttributeError) as error:
        raise PreparationError(f"Invalid numeric value at {location}: {value!r}.") from error
    if not number.is_finite():
        raise PreparationError(f"Non-finite numeric value at {location}: {value!r}.")
    return number


def read_rows(path: Path, table_type: str) -> list[SourceRow]:
    """Read data rows while removing blanks, repeated headers and summaries."""

    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))

    first_column = REQUIRED[table_type][0]
    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == first_column),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: could not find the {first_column!r} header.")
    header = [cell.strip() for cell in raw_rows[header_index]]
    if len(header) != len(set(header)):
        raise PreparationError(f"{path.name}: duplicate column names are ambiguous.")
    missing = [column for column in REQUIRED[table_type] if column not in header]
    if missing:
        raise PreparationError(f"{path.name}: missing required columns {missing}.")

    rows: list[SourceRow] = []
    for line_number, cells in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not cells or not any(cell.strip() for cell in cells):
            continue
        if len(cells) != len(header):
            raise PreparationError(
                f"{path.name}:{line_number}: expected {len(header)} fields, found {len(cells)}."
            )
        values = dict(zip(header, (cell.strip() for cell in cells), strict=True))
        first_value = values[first_column]
        if first_value in {"", first_column, "Career"} or values.get("Season") == "Career":
            continue
        rows.append(SourceRow(values, path.name, line_number))
    return rows


def validate_inputs(tables: dict[str, list[SourceRow]]) -> None:
    season_rows = tables["season"]
    if len(season_rows) != 1:
        raise PreparationError(f"Expected one explicit season row, found {len(season_rows)}.")
    season = season_rows[0].values
    if season["Season"] != "2025-26" or season["Team"] != "OKC":
        raise PreparationError("The season baseline must be Holmgren's 2025-26 OKC row.")

    for table_type in ("shared_regular", "shared_postseason"):
        rows = tables[table_type]
        if len(rows) != 2:
            raise PreparationError(f"{FILES[table_type]}: expected exactly two player aggregates.")
        players = {row.values["Player-additional"]: row.values["Player"] for row in rows}
        if players != {"holmgch01": "Chet Holmgren", "wembavi01": "Victor Wembanyama"}:
            raise PreparationError(f"{FILES[table_type]}: unexpected player population {players}.")
        game_counts = {row.values["G"] for row in rows}
        if len(game_counts) != 1:
            raise PreparationError(f"{FILES[table_type]}: player rows do not share a game count.")


def holmgren_row(rows: list[SourceRow], table_type: str) -> SourceRow:
    if table_type == "season":
        return rows[0]
    return next(row for row in rows if row.values["Player-additional"] == PLAYER_ID)


def normalize_row(table_type: str, row: SourceRow) -> dict[str, str]:
    values = row.values
    games = decimal_value(values["G"], location=f"{row.row_identifier} G")
    mpg = decimal_value(values["MP"], location=f"{row.row_identifier} MP")
    points = decimal_value(values["PTS"], location=f"{row.row_identifier} PTS")
    rebounds = decimal_value(values["TRB"], location=f"{row.row_identifier} TRB")
    attempts = decimal_value(values["FGA"], location=f"{row.row_identifier} FGA")
    free_throws = decimal_value(values["FTA"], location=f"{row.row_identifier} FTA")
    if games <= 0 or mpg <= 0 or attempts + Decimal("0.44") * free_throws <= 0:
        raise PreparationError(f"{row.row_identifier}: invalid denominator.")

    metadata = {
        "season": {
            "sample_id": "all_2025_26_regular_season",
            "season_type": "regular_season",
            "coverage_label": "2025-26",
            "population_label": "All 2025-26 regular-season games",
            "comparison_status": "full-season context; includes any qualifying shared games",
        },
        "shared_regular": {
            "sample_id": "career_shared_regular_season",
            "season_type": "regular_season",
            "coverage_label": "Career aggregate; seasons unspecified",
            "population_label": "Shared regular-season games in supplied Holmgren/Wembanyama export",
            "comparison_status": "not a same-season comparison",
        },
        "shared_postseason": {
            "sample_id": "supplied_shared_postseason",
            "season_type": "postseason",
            "coverage_label": "Supplied aggregate; season unspecified",
            "population_label": "Shared postseason games in supplied Holmgren/Wembanyama export",
            "comparison_status": "separate postseason summary; no other-opponents baseline",
        },
    }[table_type]

    total_minutes = games * mpg
    points_per_36 = points * Decimal(36) / mpg
    rebounds_per_36 = rebounds * Decimal(36) / mpg
    true_shooting = points / (Decimal(2) * (attempts + Decimal("0.44") * free_throws))
    record = {
        "sample_id": metadata["sample_id"],
        "player_id": PLAYER_ID,
        "player_name": PLAYER_NAME,
        "season_type": metadata["season_type"],
        "coverage_label": metadata["coverage_label"],
        "population_label": metadata["population_label"],
        "comparison_status": metadata["comparison_status"],
        "games": str(int(games)),
        "minutes_per_game": format(mpg, "f"),
        "approx_total_minutes": format(total_minutes.quantize(Decimal("0.1")), "f"),
        "points_per_game": format(points, "f"),
        "field_goal_attempts_per_game": format(attempts, "f"),
        "free_throw_attempts_per_game": format(free_throws, "f"),
        "rebounds_per_game": format(rebounds, "f"),
        "points_per_36": format(points_per_36.quantize(Decimal("0.01")), "f"),
        "rebounds_per_36": format(rebounds_per_36.quantize(Decimal("0.01")), "f"),
        "true_shooting_pct": format(true_shooting.quantize(Decimal("0.0001")), "f"),
        "source_filename": row.filename,
        "source_row_identifier": row.row_identifier,
        "values_reconstructed_from_rounded_per_game_averages": "true",
    }
    if tuple(record) != OUTPUT_COLUMNS:
        raise PreparationError(f"{row.row_identifier}: normalized schema mismatch.")
    return record


def validate_output(rows: list[dict[str, str]]) -> None:
    if len(rows) != 3 or len({row["sample_id"] for row in rows}) != 3:
        raise PreparationError("Expected three unique normalized sample rows.")
    expected = {
        "all_2025_26_regular_season": (69, 28.9, 21.30, 11.09, 0.6525),
        "career_shared_regular_season": (8, 29.3, 16.96, 9.22, 0.6104),
        "supplied_shared_postseason": (7, 29.9, 12.88, 8.55, 0.5992),
    }
    for row in rows:
        actual = (
            int(row["games"]),
            float(row["minutes_per_game"]),
            float(row["points_per_36"]),
            float(row["rebounds_per_36"]),
            float(row["true_shooting_pct"]),
        )
        wanted = expected[row["sample_id"]]
        if any(not math.isclose(value, target, abs_tol=0.0001) for value, target in zip(actual, wanted)):
            raise PreparationError(f"{row['sample_id']}: representative calculation failed: {actual} != {wanted}.")


def prepare(raw_dir: Path) -> list[dict[str, str]]:
    tables = {
        table_type: read_rows(raw_dir / filename, table_type)
        for table_type, filename in FILES.items()
    }
    validate_inputs(tables)
    rows = [
        normalize_row(table_type, holmgren_row(tables[table_type], table_type))
        for table_type in ("season", "shared_regular", "shared_postseason")
    ]
    validate_output(rows)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/holmgren-shared-games.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {args.output}")


if __name__ == "__main__":
    main()
