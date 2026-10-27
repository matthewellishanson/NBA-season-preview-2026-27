"""Prepare Michael Porter Jr.'s Denver-to-Brooklyn comparison dataset."""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path


TARGETS = (("2024-25", "DEN"), ("2025-26", "BRK"))
SOURCES = {
    "per_game": "MPJ_PerGame.csv",
    "per_100": "MPJ_P100P.csv",
    "advanced": "MPJ_Adv.csv",
    "shooting": "MPJ_Shooting.csv",
}
CONTEXT_FILES = ("MPJ_AdjShooting.csv", "MPJ_PlayByPlay.csv")
OUTPUT_COLUMNS = (
    "season",
    "team",
    "team_name",
    "games",
    "minutes_per_game",
    "points_per_100",
    "usage_pct",
    "assists_per_100",
    "turnovers_per_100",
    "true_shooting_pct",
    "made_twos_assisted_pct",
    "made_threes_assisted_pct",
    "per_game_source_row",
    "per_100_source_row",
    "advanced_source_row",
    "shooting_source_row",
)
EXPECTED = {
    ("2024-25", "DEN"): (77, Decimal("33.7"), Decimal("25.9"), Decimal("20.2"), Decimal("3.1"), Decimal("1.9"), Decimal(".617"), Decimal(".740"), Decimal(".922")),
    ("2025-26", "BRK"): (52, Decimal("32.5"), Decimal("36.9"), Decimal("30.5"), Decimal("4.6"), Decimal("3.6"), Decimal(".595"), Decimal(".653"), Decimal(".858")),
}


class PreparationError(RuntimeError):
    """A validation error caused by the supplied source files."""


def decimal_value(value: str, *, location: str) -> Decimal:
    try:
        number = Decimal(value.strip())
    except (AttributeError, InvalidOperation) as error:
        raise PreparationError(f"Invalid numeric value at {location}: {value!r}.") from error
    if not number.is_finite():
        raise PreparationError(f"Non-finite numeric value at {location}: {value!r}.")
    return number


def integer_value(value: str, *, location: str) -> int:
    number = decimal_value(value, location=location)
    if number != number.to_integral_value():
        raise PreparationError(f"Expected an integer at {location}, found {value!r}.")
    return int(number)


def read_simple(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    if not rows:
        raise PreparationError(f"{path.name}: empty source file.")
    header = [cell.strip() for cell in rows[0]]
    if len(header) != len(set(header)):
        raise PreparationError(f"{path.name}: duplicate leaf headers require explicit mapping.")
    required = {"Season", "Team", "G", "MP"}
    missing = sorted(required - set(header))
    if missing:
        raise PreparationError(f"{path.name}: missing required columns {missing}.")
    output: dict[tuple[str, str], dict[str, str]] = {}
    for line_number, values in enumerate(rows[1:], 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        if len(values) == len(header) - 1 and header[-1] == "Awards":
            values = [*values, ""]
        if len(values) != len(header):
            raise PreparationError(f"{path.name}:{line_number}: wrong field count.")
        row = dict(zip(header, (cell.strip() for cell in values), strict=True))
        key = (row["Season"], row["Team"])
        if key in output:
            raise PreparationError(f"{path.name}: duplicate season/team {key}.")
        row["_source_row"] = f"{path.name}:{line_number}"
        output[key] = row
    return output


def read_shooting(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    if len(rows) < 3:
        raise PreparationError(f"{path.name}: expected grouped header, leaf header and data.")
    groups = [cell.strip() for cell in rows[0]]
    leaves = [cell.strip() for cell in rows[1]]
    if len(groups) != len(leaves):
        raise PreparationError(f"{path.name}: grouped and leaf headers have different widths.")
    headers = [f"{group}|{leaf}" if group else leaf for group, leaf in zip(groups, leaves, strict=True)]
    if len(headers) != len(set(headers)):
        raise PreparationError(f"{path.name}: composite headers remain ambiguous.")
    required = {"Season", "Team", "% of FG Ast'd|2P", "% of FG Ast'd|3P"}
    missing = sorted(required - set(headers))
    if missing:
        raise PreparationError(f"{path.name}: missing assisted-makes columns {missing}.")
    output: dict[tuple[str, str], dict[str, str]] = {}
    for line_number, values in enumerate(rows[2:], 3):
        if not values or not any(cell.strip() for cell in values):
            continue
        if len(values) != len(headers):
            raise PreparationError(f"{path.name}:{line_number}: wrong field count.")
        row = dict(zip(headers, (cell.strip() for cell in values), strict=True))
        key = (row["Season"], row["Team"])
        if key in output:
            raise PreparationError(f"{path.name}: duplicate season/team {key}.")
        row["_source_row"] = f"{path.name}:{line_number}"
        output[key] = row
    return output


def prepare(raw_dir: Path) -> list[dict[str, str]]:
    for filename in CONTEXT_FILES:
        if not (raw_dir / filename).is_file():
            raise PreparationError(f"Missing context source {filename}.")

    tables = {
        "per_game": read_simple(raw_dir / SOURCES["per_game"]),
        "per_100": read_simple(raw_dir / SOURCES["per_100"]),
        "advanced": read_simple(raw_dir / SOURCES["advanced"]),
        "shooting": read_shooting(raw_dir / SOURCES["shooting"]),
    }
    output: list[dict[str, str]] = []
    for key in TARGETS:
        missing = [name for name, rows in tables.items() if key not in rows]
        if missing:
            raise PreparationError(f"{key}: missing from {missing}.")
        rows = {name: table[key] for name, table in tables.items()}
        for field in ("Season", "Team", "G", "GS"):
            values = {name: row[field] for name, row in rows.items()}
            if len(set(values.values())) != 1:
                raise PreparationError(f"{key}: {field} conflicts across sources: {values}.")
        total_minutes = {name: rows[name]["MP"] for name in ("per_100", "advanced", "shooting")}
        if len(set(total_minutes.values())) != 1:
            raise PreparationError(f"{key}: total minutes conflict: {total_minutes}.")

        per_game, per_100, advanced, shooting = (
            rows["per_game"], rows["per_100"], rows["advanced"], rows["shooting"]
        )
        values = (
            integer_value(per_game["G"], location=f"{key} games"),
            decimal_value(per_game["MP"], location=f"{key} MPG"),
            decimal_value(per_100["PTS"], location=f"{key} PTS/100"),
            decimal_value(advanced["USG%"], location=f"{key} USG%"),
            decimal_value(per_100["AST"], location=f"{key} AST/100"),
            decimal_value(per_100["TOV"], location=f"{key} TOV/100"),
            decimal_value(advanced["TS%"], location=f"{key} TS%"),
            decimal_value(shooting["% of FG Ast'd|2P"], location=f"{key} assisted 2P"),
            decimal_value(shooting["% of FG Ast'd|3P"], location=f"{key} assisted 3P"),
        )
        if values != EXPECTED[key]:
            raise PreparationError(f"{key}: displayed-value validation failed: {values}.")
        if abs(decimal_value(per_100["MP"], location=f"{key} total minutes") / values[0] - values[1]) > Decimal(".051"):
            raise PreparationError(f"{key}: total minutes / games does not match MPG within rounding tolerance.")
        for label, fraction in (("TS%", values[6]), ("assisted 2P", values[7]), ("assisted 3P", values[8])):
            if not Decimal("0") <= fraction <= Decimal("1"):
                raise PreparationError(f"{key}: {label} is not a fraction in [0, 1].")
        if not Decimal("0") <= values[3] <= Decimal("100"):
            raise PreparationError(f"{key}: USG% is not in percentage-point units.")

        output.append(
            {
                "season": key[0],
                "team": key[1],
                "team_name": "Denver Nuggets" if key[1] == "DEN" else "Brooklyn Nets",
                "games": str(values[0]),
                "minutes_per_game": format(values[1], "f"),
                "points_per_100": format(values[2], "f"),
                "usage_pct": format(values[3], "f"),
                "assists_per_100": format(values[4], "f"),
                "turnovers_per_100": format(values[5], "f"),
                "true_shooting_pct": format(values[6], "f"),
                "made_twos_assisted_pct": format(values[7], "f"),
                "made_threes_assisted_pct": format(values[8], "f"),
                "per_game_source_row": per_game["_source_row"],
                "per_100_source_row": per_100["_source_row"],
                "advanced_source_row": advanced["_source_row"],
                "shooting_source_row": shooting["_source_row"],
            }
        )
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/mpj-denver-brooklyn-2024-2026.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} validated MPJ season rows to {args.output}.")
    print("Joined Per Game, Per 100, Advanced and grouped Shooting exports by season/team.")


if __name__ == "__main__":
    main()
