"""Normalize the supplied Banchero/Wagner PBP Stats WOWY table."""

from __future__ import annotations

import argparse
import csv
import math
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYERS = {"Paolo Banchero", "Franz Wagner"}
GROUP_ORDER = (
    "both_playing",
    "banchero_only",
    "wagner_only",
    "neither_playing",
)
GROUP_LABELS = {
    "both_playing": "Both playing",
    "banchero_only": "Banchero only",
    "wagner_only": "Wagner only",
    "neither_playing": "Neither playing",
}
EXPECTED_CHECKS = {
    "both_playing": (5340, Decimal("1.95"), Decimal("112.99"), Decimal("111.04")),
    "banchero_only": (2382, Decimal("-6.45"), Decimal("111.38"), Decimal("117.83")),
    "wagner_only": (1947, Decimal("7.06"), Decimal("118.30"), Decimal("111.24")),
    "neither_playing": (1128, Decimal("0.50"), Decimal("109.46"), Decimal("108.96")),
}
REQUIRED_COLUMNS = (
    "Players On",
    "Players Off",
    "Minutes",
    "NetRtg",
    "OffRtg",
    "DefRtg",
    "2pt FG%",
    "3pt FG%",
    "Opp. 2pt FG%",
    "Opp. 3pt FG%",
)
OUTPUT_COLUMNS = (
    "group_id",
    "group_label",
    "players_on",
    "players_off",
    "minutes",
    "net_rating",
    "offensive_rating",
    "defensive_rating",
    "two_point_fg_pct",
    "three_point_fg_pct",
    "opponent_two_point_fg_pct",
    "opponent_three_point_fg_pct",
    "coverage_label",
    "source_filename",
    "source_row",
)


class PreparationError(RuntimeError):
    """Raised when the supplied source cannot be normalized safely."""


def decimal_value(value: str, *, field: str, line_number: int) -> Decimal:
    try:
        result = Decimal(value.strip())
    except (InvalidOperation, AttributeError) as error:
        raise PreparationError(f"Line {line_number}: invalid {field} value {value!r}.") from error
    if not result.is_finite():
        raise PreparationError(f"Line {line_number}: non-finite {field} value {value!r}.")
    return result


def player_list(value: str, *, field: str, line_number: int) -> tuple[str, ...]:
    # An empty cell is a valid empty player list, not missing data.
    players = tuple(player.strip() for player in value.split(",") if player.strip())
    unknown = set(players) - PLAYERS
    if unknown or len(players) != len(set(players)):
        raise PreparationError(f"Line {line_number}: invalid {field} list {value!r}.")
    return players


def percentage(value: str, *, field: str, line_number: int) -> Decimal:
    text = value.strip()
    if not text.endswith("%"):
        raise PreparationError(f"Line {line_number}: {field} must retain an explicit percent sign.")
    result = decimal_value(text[:-1], field=field, line_number=line_number) / Decimal(100)
    if result < 0 or result > 1:
        raise PreparationError(f"Line {line_number}: {field} is outside the 0-100% range.")
    return result


def group_id(players_on: tuple[str, ...], players_off: tuple[str, ...], line_number: int) -> str:
    on = set(players_on)
    off = set(players_off)
    if on & off or on | off != PLAYERS:
        raise PreparationError(f"Line {line_number}: on/off lists do not classify both selected players exactly once.")
    if on == PLAYERS:
        return "both_playing"
    if on == {"Paolo Banchero"}:
        return "banchero_only"
    if on == {"Franz Wagner"}:
        return "wagner_only"
    return "neither_playing"


def normalize(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != list(REQUIRED_COLUMNS):
            raise PreparationError(f"Unexpected columns: {reader.fieldnames!r}.")
        raw_rows = list(reader)

    rows: list[dict[str, str]] = []
    discrepancies: list[str] = []
    for line_number, raw in enumerate(raw_rows, 2):
        on = player_list(raw["Players On"], field="Players On", line_number=line_number)
        off = player_list(raw["Players Off"], field="Players Off", line_number=line_number)
        identity = group_id(on, off, line_number)
        minutes_decimal = decimal_value(raw["Minutes"], field="Minutes", line_number=line_number)
        if minutes_decimal != minutes_decimal.to_integral_value() or minutes_decimal <= 0:
            raise PreparationError(f"Line {line_number}: Minutes must be a positive integer.")
        minutes = int(minutes_decimal)
        net = decimal_value(raw["NetRtg"], field="NetRtg", line_number=line_number)
        offense = decimal_value(raw["OffRtg"], field="OffRtg", line_number=line_number)
        defense = decimal_value(raw["DefRtg"], field="DefRtg", line_number=line_number)
        if not math.isclose(float(offense - defense), float(net), abs_tol=0.011):
            raise PreparationError(f"Line {line_number}: OffRtg minus DefRtg does not reconcile with NetRtg.")

        shooting = [
            percentage(raw[column], field=column, line_number=line_number)
            for column in REQUIRED_COLUMNS[6:]
        ]
        supplied = (minutes, net, offense, defense)
        if supplied != EXPECTED_CHECKS[identity]:
            discrepancies.append(
                f"{GROUP_LABELS[identity]}: source {supplied!r} differs from editorial check {EXPECTED_CHECKS[identity]!r}"
            )
        record = {
            "group_id": identity,
            "group_label": GROUP_LABELS[identity],
            "players_on": ", ".join(on),
            "players_off": ", ".join(off),
            "minutes": str(minutes),
            "net_rating": format(net, ".2f"),
            "offensive_rating": format(offense, ".2f"),
            "defensive_rating": format(defense, ".2f"),
            "two_point_fg_pct": format(shooting[0], ".4f"),
            "three_point_fg_pct": format(shooting[1], ".4f"),
            "opponent_two_point_fg_pct": format(shooting[2], ".4f"),
            "opponent_three_point_fg_pct": format(shooting[3], ".4f"),
            "coverage_label": "PBP Stats selection beginning in 2022-23",
            "source_filename": path.name,
            "source_row": str(line_number),
        }
        rows.append(record)

    by_id = {row["group_id"]: row for row in rows}
    if len(rows) != 4 or len(by_id) != 4 or set(by_id) != set(GROUP_ORDER):
        raise PreparationError("Expected four unique on/off groups.")
    ordered = [by_id[identity] for identity in GROUP_ORDER]
    if sum(int(row["minutes"]) for row in ordered) != 10797:
        raise PreparationError("Displayed minutes do not total 10,797.")
    return ordered, discrepancies


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("assets/data/raw/Wagner&Paolo_OnOff_Career.csv"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/magic-banchero-wagner-on-off.csv"),
    )
    args = parser.parse_args()
    rows, discrepancies = normalize(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows and {sum(int(row['minutes']) for row in rows):,} minutes to {args.output}")
    if discrepancies:
        print("Authoritative source discrepancies:")
        for discrepancy in discrepancies:
            print(f"- {discrepancy}")
    else:
        print("Authoritative source matches all four editorial checks.")


if __name__ == "__main__":
    main()
