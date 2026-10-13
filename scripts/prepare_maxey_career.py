"""Normalize Tyrese Maxey's Basketball Reference career trajectory data."""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYER = "Tyrese Maxey"
TEAM = "PHI"
LEAGUE = "NBA"
SEASONS = tuple(f"{year}-{str(year + 1)[-2:]}" for year in range(2020, 2026))
FILES = {
    "per100": "MaxeyP100P.csv",
    "advanced": "MaxeyAdv.csv",
}
IDENTITY_COLUMNS = ("Season", "Age", "Team", "Lg", "Pos", "G", "GS", "MP")
REQUIRED_COLUMNS = {
    "per100": IDENTITY_COLUMNS + ("PTS", "AST"),
    "advanced": IDENTITY_COLUMNS + ("TS%", "USG%"),
}
OUTPUT_COLUMNS = (
    "season",
    "season_start_year",
    "player",
    "team",
    "age",
    "games",
    "minutes",
    "pts_per100",
    "ast_per100",
    "ts_pct",
    "usg_pct",
)


def normalized_decimal(value: str, *, leading_zero: bool = False) -> str:
    """Validate a finite decimal while preserving the source's decimal precision."""
    stripped = value.strip()
    if not stripped:
        raise ValueError("missing numeric value")
    try:
        parsed = Decimal(stripped)
    except InvalidOperation as error:
        raise ValueError(f"invalid numeric value {value!r}") from error
    if not parsed.is_finite():
        raise ValueError(f"non-finite numeric value {value!r}")
    if leading_zero and stripped.startswith("."):
        return f"0{stripped}"
    if leading_zero and stripped.startswith("-."):
        return f"-0{stripped[1:]}"
    return stripped


def read_table(path: Path, table: str) -> dict[tuple[str, str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))

    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == "Season"),
        None,
    )
    if header_index is None:
        raise ValueError(f"{path.name}: could not find the table header")

    header = [cell.strip() for cell in raw_rows[header_index]]
    missing_columns = [column for column in REQUIRED_COLUMNS[table] if column not in header]
    if missing_columns:
        raise ValueError(f"{path.name}: missing required columns {missing_columns}")
    if len(header) != len(set(header)):
        raise ValueError(f"{path.name}: duplicate leaf headers prevent an unambiguous mapping")

    records: dict[tuple[str, str, str], dict[str, str]] = {}
    for line_number, values in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        if len(values) != len(header):
            raise ValueError(f"{path.name}:{line_number}: expected {len(header)} fields, found {len(values)}")
        row = dict(zip(header, (cell.strip() for cell in values), strict=True))
        season = row["Season"]

        # Basketball Reference exports may contain repeated headers, totals,
        # postseason sections, or an in-progress next-season row. None belongs
        # in this completed regular-season career series.
        if season == "Season" or season in {"Career", ""}:
            continue
        if season == "2026-27" or season not in SEASONS:
            continue

        if row["Team"] != TEAM or row["Lg"] != LEAGUE:
            raise ValueError(
                f"{path.name}:{line_number}: unexpected player/team identity "
                f"for {season}: {row['Team']} {row['Lg']}"
            )
        for column in REQUIRED_COLUMNS[table]:
            if not row[column]:
                raise ValueError(f"{path.name}:{line_number}: missing {column}")

        key = (season, PLAYER, row["Team"])
        if key in records:
            raise ValueError(f"{path.name}:{line_number}: duplicate season identity {key}")
        records[key] = row

    found_seasons = tuple(sorted((key[0] for key in records), key=lambda season: int(season[:4])))
    if found_seasons != SEASONS:
        raise ValueError(f"{path.name}: expected seasons {SEASONS}, found {found_seasons}")
    return records


def prepare(raw_dir: Path) -> list[dict[str, str]]:
    per100 = read_table(raw_dir / FILES["per100"], "per100")
    advanced = read_table(raw_dir / FILES["advanced"], "advanced")
    if set(per100) != set(advanced):
        raise ValueError(
            "source identity mismatch: "
            f"Per 100 only={sorted(set(per100) - set(advanced))}; "
            f"Advanced only={sorted(set(advanced) - set(per100))}"
        )

    output: list[dict[str, str]] = []
    for season in SEASONS:
        key = (season, PLAYER, TEAM)
        per100_row = per100[key]
        advanced_row = advanced[key]
        conflicts = {
            column: (per100_row[column], advanced_row[column])
            for column in IDENTITY_COLUMNS
            if per100_row[column] != advanced_row[column]
        }
        if conflicts:
            raise ValueError(f"{season}: source identity conflict {conflicts}")

        for column in ("Age", "G", "MP"):
            normalized_decimal(per100_row[column])
        record = {
            "season": season,
            "season_start_year": season[:4],
            "player": PLAYER,
            "team": TEAM,
            "age": per100_row["Age"],
            "games": per100_row["G"],
            "minutes": per100_row["MP"],
            "pts_per100": normalized_decimal(per100_row["PTS"]),
            "ast_per100": normalized_decimal(per100_row["AST"]),
            "ts_pct": normalized_decimal(advanced_row["TS%"], leading_zero=True),
            "usg_pct": normalized_decimal(advanced_row["USG%"]),
        }
        if any(record[column] == "" for column in OUTPUT_COLUMNS):
            raise ValueError(f"{season}: normalized row contains a missing required value")
        output.append(record)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/maxey-career-trajectory.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} joined seasons to {args.output}")


if __name__ == "__main__":
    main()
