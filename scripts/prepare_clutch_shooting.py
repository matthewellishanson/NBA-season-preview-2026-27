#!/usr/bin/env python3
"""Normalize and validate the two supplied Stathead clutch-shooting exports."""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_POSTSEASON = ROOT / "assets/data/raw/ClutchShootingPostseason_100FGAMin_1997to2026.csv"
DEFAULT_REGULAR = ROOT / "assets/data/raw/ClutchShootingRegSeason_300FGAMin_1997to2026.csv"
DEFAULT_OUTPUT = ROOT / "assets/data/processed/clutch-shooting-leaders-1997-2026.csv"

OUTPUT_FIELDS = (
    "view",
    "source_rank",
    "player_id",
    "player_name",
    "games",
    "fg",
    "fga",
    "fg_pct",
    "fg3",
    "fg3a",
    "fg3_pct",
    "efg_pct",
    "assisted_makes",
    "assisted_share",
    "unassisted_makes",
    "unassisted_share",
)

INTEGER_FIELDS = ("Rk", "G", "FG", "FGA", "FGX", "3P", "3PA", "3PX", "Ast'd")
PERCENT_FIELDS = ("FG%", "3P%", "eFG%", "%Ast'd")
ROUNDING_TOLERANCE = Decimal("0.0005001")


def fail(message: str) -> None:
    raise ValueError(message)


def parse_int(row: dict[str, str], field: str, context: str) -> int:
    raw = row.get(field, "")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        fail(f"{context}: {field} must be an integer, got {raw!r}")
    if value < 0:
        fail(f"{context}: {field} must be nonnegative, got {value}")
    return value


def parse_decimal(row: dict[str, str], field: str, context: str, *, allow_blank: bool = False) -> Decimal | None:
    raw = row.get(field, "")
    if raw == "" and allow_blank:
        return None
    try:
        value = Decimal(raw)
    except (InvalidOperation, TypeError):
        fail(f"{context}: {field} must be numeric, got {raw!r}")
    if not Decimal("0") <= value <= Decimal("1"):
        fail(f"{context}: {field} must be between 0 and 1, got {value}")
    return value


def read_export(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        expected = {
            "Rk", "Player", "G", "FG", "FGA", "FG%", "FGX", "3P", "3PA",
            "3P%", "3PX", "eFG%", "Ast'd", "%Ast'd", "Player-additional",
        }
        missing = expected.difference(reader.fieldnames or ())
        if missing:
            fail(f"{path}: missing columns: {', '.join(sorted(missing))}")
        rows = list(reader)
    if not rows:
        fail(f"{path}: no data rows")
    return rows


def agrees_with_source(source_value: Decimal, calculated: Decimal, context: str, field: str) -> None:
    if abs(source_value - calculated) > ROUNDING_TOLERANCE:
        fail(f"{context}: {field} {source_value} does not agree with calculated {calculated}")


def validate_row(row: dict[str, str], view: str) -> dict[str, int | Decimal | None]:
    player_id = row.get("Player-additional", "").strip()
    player_name = row.get("Player", "").strip()
    context = f"{view} rank {row.get('Rk', '?')} ({player_name or 'unnamed player'})"
    if not player_id:
        fail(f"{context}: Player-additional is blank")
    if not player_name:
        fail(f"{context}: Player is blank")

    numbers = {field: parse_int(row, field, context) for field in INTEGER_FIELDS}
    percentages = {
        field: parse_decimal(row, field, context, allow_blank=(field == "3P%"))
        for field in PERCENT_FIELDS
    }

    fg = numbers["FG"]
    fga = numbers["FGA"]
    fg3 = numbers["3P"]
    fg3a = numbers["3PA"]
    assisted = numbers["Ast'd"]

    if fg + numbers["FGX"] != fga:
        fail(f"{context}: FG + FGX must equal FGA")
    if fg3 + numbers["3PX"] != fg3a:
        fail(f"{context}: 3P + 3PX must equal 3PA")
    if not 0 <= fg3 <= fg:
        fail(f"{context}: 3P must be between 0 and FG")
    if not 0 <= assisted <= fg:
        fail(f"{context}: Ast'd must be between 0 and FG")
    if fga == 0 or fg == 0:
        fail(f"{context}: selected rows require positive FGA and FG")

    fg_pct = percentages["FG%"]
    efg_pct = percentages["eFG%"]
    assisted_share = percentages["%Ast'd"]
    assert fg_pct is not None and efg_pct is not None and assisted_share is not None
    agrees_with_source(fg_pct, Decimal(fg) / Decimal(fga), context, "FG%")
    agrees_with_source(
        efg_pct,
        (Decimal(fg) + Decimal("0.5") * Decimal(fg3)) / Decimal(fga),
        context,
        "eFG%",
    )
    agrees_with_source(assisted_share, Decimal(assisted) / Decimal(fg), context, "%Ast'd")

    fg3_pct = percentages["3P%"]
    if fg3a == 0:
        if fg3_pct is not None:
            fail(f"{context}: 3P% must be blank when 3PA is zero")
    else:
        if fg3_pct is None:
            fail(f"{context}: 3P% cannot be blank when 3PA is positive")
        agrees_with_source(fg3_pct, Decimal(fg3) / Decimal(fg3a), context, "3P%")

    return {**numbers, **percentages}


def select_and_validate(rows: list[dict[str, str]], view: str, minimum_fga: int, expected_raw_rows: int) -> list[dict[str, str]]:
    if len(rows) != expected_raw_rows:
        fail(f"{view}: expected {expected_raw_rows} supplied rows, found {len(rows)}")

    ranks = [parse_int(row, "Rk", f"{view} source row {index + 1}") for index, row in enumerate(rows)]
    if ranks != sorted(ranks) or len(ranks) != len(set(ranks)):
        fail(f"{view}: source ranks must be unique and remain in ascending source order")

    selected = rows if view == "playoffs" else rows[:25]
    if len(selected) != 25:
        fail(f"{view}: expected 25 selected rows, found {len(selected)}")

    player_ids: set[str] = set()
    for row in selected:
        numbers = validate_row(row, view)
        player_id = row["Player-additional"].strip()
        if player_id in player_ids:
            fail(f"{view}: duplicate Player-additional value {player_id!r}")
        player_ids.add(player_id)
        if numbers["FGA"] < minimum_fga:
            fail(f"{view} rank {row['Rk']}: FGA {numbers['FGA']} is below the {minimum_fga} minimum")

    return selected


def normalized_row(row: dict[str, str], view: str) -> dict[str, str | int]:
    fg = int(row["FG"])
    assisted = int(row["Ast'd"])
    unassisted = fg - assisted
    return {
        "view": view,
        "source_rank": int(row["Rk"]),
        "player_id": row["Player-additional"].strip(),
        "player_name": row["Player"].strip(),
        "games": int(row["G"]),
        "fg": fg,
        "fga": int(row["FGA"]),
        "fg_pct": row["FG%"],
        "fg3": int(row["3P"]),
        "fg3a": int(row["3PA"]),
        "fg3_pct": row["3P%"],
        "efg_pct": row["eFG%"],
        "assisted_makes": assisted,
        "assisted_share": row["%Ast'd"],
        "unassisted_makes": unassisted,
        "unassisted_share": f"{Decimal(unassisted) / Decimal(fg):.6f}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--postseason", type=Path, default=DEFAULT_POSTSEASON)
    parser.add_argument("--regular-season", type=Path, default=DEFAULT_REGULAR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    postseason = select_and_validate(read_export(args.postseason), "playoffs", 100, 25)
    regular = select_and_validate(read_export(args.regular_season), "regular_season", 300, 100)
    output_rows = [
        *(normalized_row(row, "playoffs") for row in postseason),
        *(normalized_row(row, "regular_season") for row in regular),
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(output_rows)

    print(f"Wrote {len(output_rows)} rows to {args.output.relative_to(ROOT)}")
    print("Validated: 25 playoff rows (FGA >= 100); 25 regular-season rows (FGA >= 300).")
    print("Validated: unique IDs, source order/ranks, numeric fields, make/miss identities, bounds, and percentage rounding.")


if __name__ == "__main__":
    main()
