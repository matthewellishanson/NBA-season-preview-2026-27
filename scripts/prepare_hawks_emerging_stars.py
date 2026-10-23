"""Prepare the Atlanta Hawks emerging-stars chart data.

The supplied Basketball Reference-style exports are player-specific Per Game,
Per 100 Possessions and Advanced tables. This script keeps the three requested
completed regular seasons, prefers a combined TOT/nTM row when one exists, and
joins the tables one-to-one without averaging rates or percentages.
"""

from __future__ import annotations

import argparse
import csv
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path


SEASONS = ("2023-24", "2024-25", "2025-26")
AGGREGATE_TEAM = re.compile(r"^(?:TOT|\d+TM)$")
MPG_TOLERANCE = Decimal("0.051")

PLAYERS = (
    {
        "id": "johnsja05",
        "name": "Jalen Johnson",
        "slug": "jalen-johnson",
        "files": {
            "per_game": "JalenJohnson_PerGame_Career.csv",
            "p100": "JalenJohnson_P100P_Career.csv",
            "advanced": "JalenJohnson_Adv_Career.csv",
        },
    },
    {
        "id": "alexani01",
        "name": "Nickeil Alexander-Walker",
        "slug": "nickeil-alexander-walker",
        "files": {
            "per_game": "NAW_PerGame_Career.csv",
            "p100": "NAW_P100P_Career.csv",
            "advanced": "NAW_Adv_Career.csv",
        },
    },
)

COMMON = ("Season", "Age", "Team", "Lg", "Pos", "G", "GS", "MP")
REQUIRED = {
    "per_game": COMMON + ("PTS", "AST"),
    "p100": COMMON + ("PTS", "AST"),
    "advanced": COMMON + ("TS%",),
}
OUTPUT_COLUMNS = (
    "player_id", "player_name", "player_slug", "season", "season_start",
    "season_type", "source_team", "team_stints", "is_combined_total",
    "season_age", "games", "starts", "minutes_per_game", "total_minutes",
    "points_per_game", "assists_per_game", "points_per_100",
    "assists_per_100", "ts_pct", "per_game_source_row_id",
    "p100_source_row_id", "advanced_source_row_id",
)


class PreparationError(RuntimeError):
    """Raised when a source file cannot produce a truthful normalized row."""


def number(value: str, location: str) -> Decimal:
    try:
        parsed = Decimal(value.strip())
    except (InvalidOperation, AttributeError) as error:
        raise PreparationError(f"Invalid numeric value at {location}: {value!r}.") from error
    if not parsed.is_finite():
        raise PreparationError(f"Non-finite numeric value at {location}.")
    return parsed


def integer(value: str, location: str) -> int:
    parsed = number(value, location)
    if parsed != parsed.to_integral_value():
        raise PreparationError(f"Expected integer at {location}: {value!r}.")
    return int(parsed)


def read_table(path: Path, table_type: str) -> tuple[dict[str, dict[str, str]], list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    header_index = next((i for i, row in enumerate(rows) if row and row[0].strip() == "Season"), None)
    if header_index is None:
        raise PreparationError(f"{path.name}: Season header not found.")
    header = [cell.strip() for cell in rows[header_index]]
    missing = [column for column in REQUIRED[table_type] if column not in header]
    if missing:
        raise PreparationError(f"{path.name}: missing columns {missing}.")

    candidates: dict[str, list[dict[str, str]]] = defaultdict(list)
    excluded: list[str] = []
    for line_number, values in enumerate(rows[header_index + 1:], header_index + 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        if len(values) != len(header):
            raise PreparationError(f"{path.name}:{line_number}: field count differs from header.")
        row = dict(zip(header, (cell.strip() for cell in values), strict=True))
        row_id = f"{path.name}:line-{line_number}"
        season = row["Season"]
        if season == "Season":
            excluded.append(f"{row_id} repeated header")
            continue
        if season in {"", "Career"}:
            excluded.append(f"{row_id} career/summary row")
            continue
        if season not in SEASONS:
            excluded.append(f"{row_id} outside requested coverage ({season})")
            continue
        row["_source_row_id"] = row_id
        candidates[season].append(row)

    selected: dict[str, dict[str, str]] = {}
    for season in SEASONS:
        season_rows = candidates.get(season, [])
        aggregates = [row for row in season_rows if AGGREGATE_TEAM.fullmatch(row["Team"])]
        if len(aggregates) > 1:
            raise PreparationError(f"{path.name}: multiple combined rows for {season}.")
        if aggregates:
            chosen = aggregates[0]
            excluded.extend(
                f"{row['_source_row_id']} stint excluded for {chosen['_source_row_id']}"
                for row in season_rows if row is not chosen
            )
        elif len(season_rows) == 1:
            chosen = season_rows[0]
        elif not season_rows:
            raise PreparationError(f"{path.name}: missing {season}.")
        else:
            raise PreparationError(f"{path.name}: multiple {season} stints without a combined row.")
        selected[season] = chosen
    return selected, excluded


def prepare(raw_dir: Path) -> tuple[list[dict[str, str]], list[str]]:
    output: list[dict[str, str]] = []
    excluded: list[str] = []
    for player in PLAYERS:
        tables: dict[str, dict[str, dict[str, str]]] = {}
        for table_type, filename in player["files"].items():
            tables[table_type], audit = read_table(raw_dir / filename, table_type)
            excluded.extend(audit)
        if len({frozenset(table) for table in tables.values()}) != 1:
            raise PreparationError(f"{player['name']}: source season keys differ.")

        for season in SEASONS:
            joined = {table_type: table[season] for table_type, table in tables.items()}
            for column in ("Age", "Team", "Lg", "Pos", "G", "GS"):
                values = {row[column] for row in joined.values()}
                if len(values) != 1:
                    raise PreparationError(f"{player['name']} {season}: {column} conflicts across sources.")
            per_game, p100, advanced = joined["per_game"], joined["p100"], joined["advanced"]
            if per_game["Lg"] != "NBA" or p100["MP"] != advanced["MP"]:
                raise PreparationError(f"{player['name']} {season}: league or total-minute mismatch.")
            games = integer(per_game["G"], f"{player['name']} {season} G")
            mpg = number(per_game["MP"], f"{player['name']} {season} MPG")
            total_minutes = number(p100["MP"], f"{player['name']} {season} total MP")
            if games <= 0 or abs(total_minutes / games - mpg) > MPG_TOLERANCE:
                raise PreparationError(f"{player['name']} {season}: games/minutes are inconsistent.")
            ts_pct = number(advanced["TS%"], f"{player['name']} {season} TS%")
            if not Decimal("0") <= ts_pct <= Decimal("1"):
                raise PreparationError(f"{player['name']} {season}: TS% outside [0, 1].")
            team = per_game["Team"]
            record = {
                "player_id": player["id"], "player_name": player["name"],
                "player_slug": player["slug"], "season": season,
                "season_start": season[:4], "season_type": "regular_season",
                "source_team": team, "team_stints": "",
                "is_combined_total": str(bool(AGGREGATE_TEAM.fullmatch(team))).lower(),
                "season_age": str(integer(per_game["Age"], f"{player['name']} {season} Age")),
                "games": str(games), "starts": per_game["GS"],
                "minutes_per_game": format(mpg, "f"), "total_minutes": format(total_minutes, "f"),
                "points_per_game": per_game["PTS"], "assists_per_game": per_game["AST"],
                "points_per_100": p100["PTS"], "assists_per_100": p100["AST"],
                "ts_pct": format(ts_pct, "f"),
                "per_game_source_row_id": per_game["_source_row_id"],
                "p100_source_row_id": p100["_source_row_id"],
                "advanced_source_row_id": advanced["_source_row_id"],
            }
            output.append(record)

    identities = {(row["player_id"], row["season"], row["source_team"]) for row in output}
    if len(output) != 6 or len(identities) != 6:
        raise PreparationError("Expected six unique player-season-team records.")
    expected = {
        ("johnsja05", "2023-24"): ("ATL", 56, 33.7, 22.7, 5.2, .584),
        ("johnsja05", "2024-25"): ("ATL", 36, 35.7, 24.8, 6.6, .569),
        ("johnsja05", "2025-26"): ("ATL", 72, 35.2, 30.2, 10.6, .581),
        ("alexani01", "2023-24"): ("MIN", 82, 23.4, 16.9, 5.2, .578),
        ("alexani01", "2024-25"): ("MIN", 82, 25.3, 18.4, 5.3, .579),
        ("alexani01", "2025-26"): ("ATL", 78, 33.4, 29.5, 5.2, .610),
    }
    for row in output:
        actual = (row["source_team"], int(row["games"]), float(row["minutes_per_game"]),
                  float(row["points_per_100"]), float(row["assists_per_100"]), float(row["ts_pct"]))
        if actual != expected[(row["player_id"], row["season"])]:
            raise PreparationError(f"Source spot check failed for {row['player_name']} {row['season']}: {actual}")
    return output, excluded


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument("--output", type=Path, default=Path("assets/data/processed/hawks-emerging-stars-2023-2026.csv"))
    args = parser.parse_args()
    rows, excluded = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {args.output}")
    print("PASS: requested seasons, one-to-one joins, combined-row rules and source spot checks")
    print(f"Excluded {len(excluded)} out-of-window, summary, repeated-header or constituent rows")


if __name__ == "__main__":
    main()
