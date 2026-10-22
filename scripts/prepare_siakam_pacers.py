"""Normalize Pascal Siakam's supplied regular-season career exports."""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYER_ID = "siakapa01"
PLAYER_NAME = "Pascal Siakam"
LEAGUE = "NBA"
PUBLISHED_SEASONS = ("2023-24", "2024-25", "2025-26")
COMPLETED_CAREER_SEASONS = tuple(f"{year}-{str(year + 1)[-2:]}" for year in range(2016, 2026))
FILES = {
    "per_game": "SiakamPerGameCareer.csv",
    "per_100": "SiakamP100PCareer.csv",
    "advanced": "SiakamAdvCareer.csv",
}
REQUIRED_COLUMNS = {
    "per_game": ("Season", "Age", "Team", "Lg", "G", "GS", "MP", "PTS"),
    "per_100": ("Season", "Age", "Team", "Lg", "G", "GS", "MP", "PTS"),
    "advanced": ("Season", "Age", "Team", "Lg", "G", "GS", "MP", "TS%"),
}
OUTPUT_COLUMNS = (
    "player_id",
    "player_name",
    "season",
    "season_start",
    "source_team_code",
    "team_label",
    "stint_id",
    "stint_scope",
    "league",
    "season_age",
    "games",
    "starts",
    "minutes_per_game",
    "total_minutes",
    "points_per_game",
    "points_per_100",
    "true_shooting_pct",
    "published_comparison",
    "per_game_source_row_id",
    "per_100_source_row_id",
    "advanced_source_row_id",
)


class PreparationError(RuntimeError):
    """Raised when the supplied tables cannot be joined without guessing."""


@dataclass(frozen=True)
class SourceRow:
    values: dict[str, str]
    filename: str
    line_number: int

    @property
    def row_id(self) -> str:
        return f"{self.filename}:line-{self.line_number}"


def decimal(value: str, *, location: str) -> Decimal:
    try:
        number = Decimal(value.strip())
    except (InvalidOperation, AttributeError) as error:
        raise PreparationError(f"{location}: invalid numeric value {value!r}.") from error
    if not number.is_finite():
        raise PreparationError(f"{location}: numeric value must be finite.")
    return number


def integer_text(value: str, *, location: str) -> str:
    number = decimal(value, location=location)
    if number != number.to_integral_value():
        raise PreparationError(f"{location}: expected an integer, found {value!r}.")
    return str(int(number))


def number_text(value: str, *, location: str) -> str:
    return format(decimal(value, location=location), "f")


def fraction_text(value: str, *, location: str) -> str:
    number = decimal(value, location=location)
    if not Decimal("0") <= number <= Decimal("1"):
        raise PreparationError(f"{location}: expected a fraction in [0, 1], found {number}.")
    return format(number, "f")


def read_source(path: Path, table_type: str) -> dict[str, SourceRow]:
    """Read one selected full-season row per completed season.

    If a future export includes both combined and team-stint rows, the combined
    TOT/2TM row wins. Multiple team rows without a combined row are rejected;
    rate statistics are never averaged across stints.
    """

    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))

    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == "Season"),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: missing Season header.")
    header = [cell.strip() for cell in raw_rows[header_index]]
    if len(header) != len(set(header)):
        raise PreparationError(f"{path.name}: duplicate header names are ambiguous.")
    missing = [column for column in REQUIRED_COLUMNS[table_type] if column not in header]
    if missing:
        raise PreparationError(f"{path.name}: missing required columns {missing}.")

    by_season: dict[str, list[SourceRow]] = {}
    for line_number, cells in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not cells or not any(cell.strip() for cell in cells):
            continue
        if len(cells) != len(header):
            raise PreparationError(
                f"{path.name}:{line_number}: expected {len(header)} fields, found {len(cells)}."
            )
        values = dict(zip(header, (cell.strip() for cell in cells), strict=True))
        season = values["Season"]
        if season in {"", "Season", "Career"}:
            continue
        if season not in COMPLETED_CAREER_SEASONS:
            # Excludes postseason labels and incomplete 2026-27 or later rows.
            continue
        if values["Lg"] != LEAGUE:
            raise PreparationError(f"{path.name}:{line_number}: unexpected league {values['Lg']!r}.")
        by_season.setdefault(season, []).append(SourceRow(values, path.name, line_number))

    selected: dict[str, SourceRow] = {}
    for season, candidates in by_season.items():
        combined = [row for row in candidates if row.values["Team"] in {"TOT", "2TM"}]
        if len(combined) == 1:
            selected[season] = combined[0]
        elif len(combined) > 1:
            raise PreparationError(f"{path.name}: multiple combined rows for {season}.")
        elif len(candidates) == 1:
            selected[season] = candidates[0]
        else:
            teams = [row.values["Team"] for row in candidates]
            raise PreparationError(
                f"{path.name}: {season} has team stints {teams} but no combined row; "
                "rates will not be averaged."
            )

    if set(selected) != set(COMPLETED_CAREER_SEASONS):
        missing_seasons = sorted(set(COMPLETED_CAREER_SEASONS) - set(selected))
        extra_seasons = sorted(set(selected) - set(COMPLETED_CAREER_SEASONS))
        raise PreparationError(
            f"{path.name}: completed-season coverage mismatch; "
            f"missing={missing_seasons}, extra={extra_seasons}."
        )
    return selected


def validate_join(season: str, rows: dict[str, SourceRow]) -> None:
    for column in ("Season", "Age", "Team", "Lg", "G", "GS"):
        values = {kind: row.values[column] for kind, row in rows.items()}
        if len(set(values.values())) != 1:
            raise PreparationError(f"{season}: {column} conflicts across sources: {values}.")
    if rows["per_100"].values["MP"] != rows["advanced"].values["MP"]:
        raise PreparationError(f"{season}: per-100 and advanced total minutes disagree.")

    games = decimal(rows["per_game"].values["G"], location=f"{season} games")
    mpg = decimal(rows["per_game"].values["MP"], location=f"{season} MPG")
    total_minutes = decimal(rows["per_100"].values["MP"], location=f"{season} minutes")
    if games <= 0 or abs(total_minutes / games - mpg) > Decimal("0.051"):
        raise PreparationError(f"{season}: MPG does not reconcile with total minutes and games.")


def prepare(raw_dir: Path) -> list[dict[str, str]]:
    tables = {
        table_type: read_source(raw_dir / filename, table_type)
        for table_type, filename in FILES.items()
    }
    if len({frozenset(rows) for rows in tables.values()}) != 1:
        raise PreparationError("The three source files do not have identical season coverage.")

    output: list[dict[str, str]] = []
    for season in COMPLETED_CAREER_SEASONS:
        rows = {table_type: table[season] for table_type, table in tables.items()}
        validate_join(season, rows)
        per_game = rows["per_game"]
        per_100 = rows["per_100"]
        advanced = rows["advanced"]
        source_team = per_game.values["Team"]
        is_combined = source_team in {"TOT", "2TM"}
        team_label = "TOR/IND" if season == "2023-24" and is_combined else source_team

        record = {
            "player_id": PLAYER_ID,
            "player_name": PLAYER_NAME,
            "season": season,
            "season_start": season[:4],
            "source_team_code": source_team,
            "team_label": team_label,
            "stint_id": "TOT" if is_combined else source_team,
            "stint_scope": "combined-season" if is_combined else "single-team",
            "league": per_game.values["Lg"],
            "season_age": integer_text(per_game.values["Age"], location=f"{season} age"),
            "games": integer_text(per_game.values["G"], location=f"{season} games"),
            "starts": integer_text(per_game.values["GS"], location=f"{season} starts"),
            "minutes_per_game": number_text(per_game.values["MP"], location=f"{season} MPG"),
            "total_minutes": integer_text(per_100.values["MP"], location=f"{season} minutes"),
            "points_per_game": number_text(per_game.values["PTS"], location=f"{season} PPG"),
            "points_per_100": number_text(per_100.values["PTS"], location=f"{season} points/100"),
            "true_shooting_pct": fraction_text(advanced.values["TS%"], location=f"{season} TS%"),
            "published_comparison": "true" if season in PUBLISHED_SEASONS else "false",
            "per_game_source_row_id": per_game.row_id,
            "per_100_source_row_id": per_100.row_id,
            "advanced_source_row_id": advanced.row_id,
        }
        if tuple(record) != OUTPUT_COLUMNS:
            raise PreparationError(f"{season}: output schema drifted.")
        output.append(record)

    published = [row for row in output if row["published_comparison"] == "true"]
    if [row["season"] for row in published] != list(PUBLISHED_SEASONS):
        raise PreparationError("Published comparison must contain one row for each target season.")
    return output


def write_csv(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/siakam-pacers-career.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    write_csv(rows, args.output)
    print(f"Wrote {len(rows)} completed regular seasons to {args.output}.")


if __name__ == "__main__":
    main()
