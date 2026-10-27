"""Prepare the Brooklyn five-rookie comparison dataset.

The three inputs are Stathead/Basketball Reference rookie-season exports.
They contain duplicate leaf headers, so columns are resolved by their exact
position and occurrence before the tables are joined on player ID and season.
"""

from __future__ import annotations

import argparse
import csv
import math
import statistics
from decimal import Decimal, InvalidOperation
from pathlib import Path


SEASONS = ("2023-24", "2024-25", "2025-26")
FEATURED_SEASON = "2025-26"
MIN_GAMES = 15
MIN_MINUTES_PER_GAME = Decimal("10")
EXPECTED_POOL_SIZE = 138
EXPECTED_FEATURED_CLASS_SIZE = 48

SOURCES = {
    "advanced": ("Rookies_Adv_2023to26.csv", "Player-additional"),
    "per_100": ("Rookies_P100P_2023to26.csv", "-9999"),
    "per_game": ("Rookies_PerGame_2023to26.csv", "-9999"),
}

# Editorial display names are explicit because two source names contain a
# replacement character. Stable Basketball Reference IDs determine identity.
FEATURED_PLAYERS = (
    ("wolfda01", "Danny Wolf"),
    ("demineg01", "Egor Demin"),
    ("traorno01", "Nolan Traore"),
    ("sarafbe01", "Ben Saraf"),
    ("poweldr01", "Drake Powell"),
)

OUTPUT_COLUMNS = (
    "record_type",
    "player_id",
    "player_name",
    "season",
    "team",
    "games",
    "minutes_per_game",
    "points_per_100",
    "assists_per_100",
    "true_shooting_pct",
    "turnovers_per_100",
    "usage_pct",
    "benchmark_population",
    "advanced_source_row",
    "per_100_source_row",
    "per_game_source_row",
)


class PreparationError(RuntimeError):
    """A validation error caused by the source data or configuration."""


def decimal_value(value: str, *, location: str) -> Decimal:
    try:
        number = Decimal(value.strip())
    except (InvalidOperation, AttributeError) as error:
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


def unique_headers(header: list[str]) -> list[str]:
    """Give duplicate leaf headers stable occurrence suffixes."""

    counts: dict[str, int] = {}
    result: list[str] = []
    for raw_name in header:
        name = raw_name.strip()
        counts[name] = counts.get(name, 0) + 1
        result.append(name if counts[name] == 1 else f"{name}__{counts[name]}")
    return result


def read_source(path: Path, id_header: str) -> dict[tuple[str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))

    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == "Rk"),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: could not find the Rk header row.")
    header = unique_headers(raw_rows[header_index])
    required = {
        "Player",
        "PTS/100 Poss.",
        "G",
        "G__2",
        "MP/G",
        "Season",
        "Team",
        id_header,
    }
    missing = sorted(required - set(header))
    if missing:
        raise PreparationError(f"{path.name}: missing required columns {missing}.")

    rows: dict[tuple[str, str], dict[str, str]] = {}
    for line_number, values in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        if len(values) != len(header):
            raise PreparationError(
                f"{path.name}:{line_number}: expected {len(header)} fields, found {len(values)}."
            )
        row = dict(zip(header, (cell.strip() for cell in values), strict=True))
        player_id = row[id_header]
        season = row["Season"]
        if not player_id or season not in SEASONS:
            raise PreparationError(
                f"{path.name}:{line_number}: unexpected identity {player_id!r}, {season!r}."
            )
        key = (player_id, season)
        if key in rows:
            raise PreparationError(f"{path.name}: duplicate player-season key {key}.")
        if row["G"] != row["G__2"]:
            raise PreparationError(
                f"{path.name}:{line_number}: duplicated games fields disagree "
                f"({row['G']} vs {row['G__2']})."
            )
        row["_source_row"] = f"{path.name}:{line_number}"
        rows[key] = row

    if len(rows) != EXPECTED_POOL_SIZE:
        raise PreparationError(
            f"{path.name}: expected {EXPECTED_POOL_SIZE} player-seasons, found {len(rows)}."
        )
    return rows


def validate_shared_fields(
    key: tuple[str, str], tables: dict[str, dict[tuple[str, str], dict[str, str]]]
) -> None:
    rows = {table_name: table[key] for table_name, table in tables.items()}
    for column in ("Player", "Season", "Team", "G", "MP/G", "PTS/100 Poss."):
        values = {table_name: row[column] for table_name, row in rows.items()}
        if len(set(values.values())) != 1:
            raise PreparationError(f"{key}: {column} conflicts across sources: {values}.")

    games = integer_value(rows["per_game"]["G"], location=f"{key} games")
    minutes_per_game = decimal_value(rows["per_game"]["MP/G"], location=f"{key} MP/G")
    if games < MIN_GAMES or minutes_per_game < MIN_MINUTES_PER_GAME:
        raise PreparationError(
            f"{key}: row does not satisfy {MIN_GAMES} games and "
            f"{MIN_MINUTES_PER_GAME} minutes per game."
        )


def median_decimal(values: list[Decimal]) -> Decimal:
    return Decimal(str(statistics.median(values)))


def prepare(raw_dir: Path) -> list[dict[str, str]]:
    tables = {
        table_name: read_source(raw_dir / filename, id_header)
        for table_name, (filename, id_header) in SOURCES.items()
    }
    key_sets = {table_name: set(rows) for table_name, rows in tables.items()}
    if len({frozenset(keys) for keys in key_sets.values()}) != 1:
        raise PreparationError(
            "The three source tables do not have identical player-ID/season join keys."
        )
    keys = sorted(key_sets["advanced"], key=lambda key: (key[1], key[0]))
    for key in keys:
        validate_shared_fields(key, tables)
        true_shooting = decimal_value(
            tables["per_100"][key]["TS%"], location=f"{key} TS%"
        )
        usage = decimal_value(tables["advanced"][key]["USG%"], location=f"{key} USG%")
        if not Decimal("0") <= true_shooting <= Decimal("1"):
            raise PreparationError(f"{key}: TS% must be a fraction in [0, 1].")
        if not Decimal("0") <= usage <= Decimal("100"):
            raise PreparationError(f"{key}: USG% must use percentage-point units.")

    class_size = sum(key[1] == FEATURED_SEASON for key in keys)
    if class_size != EXPECTED_FEATURED_CLASS_SIZE:
        raise PreparationError(
            f"Expected {EXPECTED_FEATURED_CLASS_SIZE} rows in {FEATURED_SEASON}, found {class_size}."
        )

    output: list[dict[str, str]] = []
    for player_id, display_name in FEATURED_PLAYERS:
        key = (player_id, FEATURED_SEASON)
        if key not in key_sets["advanced"]:
            raise PreparationError(f"Missing featured player-season {key}.")
        advanced = tables["advanced"][key]
        per_100 = tables["per_100"][key]
        per_game = tables["per_game"][key]
        if per_game["Team"] != "BRK":
            raise PreparationError(f"{display_name}: expected BRK, found {per_game['Team']}.")

        true_shooting = decimal_value(per_100["TS%"], location=f"{display_name} TS%")
        if not Decimal("0") <= true_shooting <= Decimal("1"):
            raise PreparationError(f"{display_name}: TS% must be a fraction in [0, 1].")
        usage = decimal_value(advanced["USG%"], location=f"{display_name} USG%")
        if not Decimal("0") <= usage <= Decimal("100"):
            raise PreparationError(f"{display_name}: USG% must use percentage-point units.")

        output.append(
            {
                "record_type": "featured_player",
                "player_id": player_id,
                "player_name": display_name,
                "season": FEATURED_SEASON,
                "team": "BRK",
                "games": per_game["G"],
                "minutes_per_game": per_game["MP/G"],
                "points_per_100": per_100["PTS"],
                "assists_per_100": per_100["AST"],
                "true_shooting_pct": decimal_text(true_shooting),
                "turnovers_per_100": per_100["TOV"],
                "usage_pct": advanced["USG%"],
                "benchmark_population": "",
                "advanced_source_row": advanced["_source_row"],
                "per_100_source_row": per_100["_source_row"],
                "per_game_source_row": per_game["_source_row"],
            }
        )

    def values(table_name: str, column: str) -> list[Decimal]:
        return [decimal_value(tables[table_name][key][column], location=f"{key} {column}") for key in keys]

    output.append(
        {
            "record_type": "benchmark_median",
            "player_id": "qualified_rookie_median_2023_26",
            "player_name": "Qualified rookie median",
            "season": "2023-24 through 2025-26",
            "team": "",
            "games": decimal_text(median_decimal(values("per_game", "G"))),
            "minutes_per_game": decimal_text(median_decimal(values("per_game", "MP/G"))),
            "points_per_100": decimal_text(median_decimal(values("per_100", "PTS"))),
            "assists_per_100": decimal_text(median_decimal(values("per_100", "AST"))),
            "true_shooting_pct": decimal_text(median_decimal(values("per_100", "TS%"))),
            "turnovers_per_100": decimal_text(median_decimal(values("per_100", "TOV"))),
            "usage_pct": decimal_text(median_decimal(values("advanced", "USG%"))),
            "benchmark_population": (
                "Median of 138 qualified rookie player-seasons, 2023-24 through 2025-26 "
                "(minimum 15 games and 10 minutes per game)"
            ),
            "advanced_source_row": "",
            "per_100_source_row": "",
            "per_game_source_row": "",
        }
    )

    if len(output) != 6 or len({row["player_id"] for row in output}) != 6:
        raise PreparationError("Expected five featured rows and one benchmark row.")
    for row in output:
        for field in (
            "games",
            "minutes_per_game",
            "points_per_100",
            "assists_per_100",
            "true_shooting_pct",
            "turnovers_per_100",
            "usage_pct",
        ):
            value = float(row[field])
            if not math.isfinite(value):
                raise PreparationError(f"{row['player_id']}: non-finite output {field}.")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/nets-rookie-comparison-2025-26.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} chart rows to {args.output}.")
    print("Validated 138 one-to-one player-ID/season joins across all three sources.")
    print("Validated 48 qualified 2025-26 rookies and all five Brooklyn rows.")


if __name__ == "__main__":
    main()
