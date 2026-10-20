"""Normalize Kawhi Leonard Basketball Reference exports for the Raptors preview."""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYER_ID = "leonaka01"
PLAYER_NAME = "Kawhi Leonard"
LEAGUE = "NBA"
FILES = {
    "regular_season": {
        "per_game": "KawhiRegSeason_PerGame.csv",
        "per_100": "KawhiRegSeason_P100P.csv",
        "advanced": "KawhiRegSeason_Adv.csv",
    },
    "postseason": {
        "per_game": "KawhiPostseason_PerGame.csv",
        "per_100": "KawhiPostseason_P100P.csv",
        "advanced": "KawhiPostseason_Adv.csv",
    },
}
TABLE_COLUMNS = {
    "per_game": ("Season", "Age", "Team", "Lg", "G", "GS", "MP", "PTS"),
    "per_100": ("Season", "Age", "Team", "Lg", "G", "GS", "MP", "PTS", "AST"),
    "advanced": ("Season", "Age", "Team", "Lg", "G", "GS", "MP", "TS%", "USG%", "TOV%"),
}
OUTPUT_COLUMNS = (
    "player_id",
    "player_name",
    "season",
    "season_start",
    "season_type",
    "source_team",
    "season_age",
    "games",
    "starts",
    "minutes_per_game",
    "total_minutes",
    "points_per_game",
    "points_per_100",
    "assists_per_100",
    "ts_pct",
    "usage_pct",
    "turnover_pct",
    "appearance_status",
    "source_filenames",
    "original_row_identifiers",
    "data_basis",
)
SUMMARY_VALUES = {"", "Career", "Season"}
AGGREGATE_TEAMS = {"TOT", "2TM", "3TM", "4TM", "5TM"}


@dataclass(frozen=True)
class SourceRow:
    values: dict[str, str]
    filename: str
    line_number: int

    @property
    def row_id(self) -> str:
        return f"{self.filename}:line-{self.line_number}"


def decimal(value: str, context: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise ValueError(f"{context}: invalid number {value!r}") from error
    if not parsed.is_finite():
        raise ValueError(f"{context}: non-finite number {value!r}")
    return parsed


def normalize_fraction(value: str, context: str) -> str:
    decimal(value, context)
    return f"0{value}" if value.startswith(".") else value


def read_source(path: Path, table_type: str) -> list[SourceRow]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    header_index = next(
        (index for index, row in enumerate(rows) if row and row[0].strip() == "Season"),
        None,
    )
    if header_index is None:
        raise ValueError(f"{path.name}: header not found")
    header = [cell.strip() for cell in rows[header_index]]
    if len(header) != len(set(header)):
        raise ValueError(f"{path.name}: duplicate column names")
    missing = [column for column in TABLE_COLUMNS[table_type] if column not in header]
    if missing:
        raise ValueError(f"{path.name}: missing columns {missing}")

    records: list[SourceRow] = []
    for line_number, cells in enumerate(rows[header_index + 1 :], header_index + 2):
        if not cells or not any(cell.strip() for cell in cells):
            continue
        if len(cells) != len(header):
            raise ValueError(f"{path.name}:{line_number}: expected {len(header)} fields, got {len(cells)}")
        values = dict(zip(header, (cell.strip() for cell in cells), strict=True))
        if values["Season"] in SUMMARY_VALUES:
            continue
        records.append(SourceRow(values, path.name, line_number))
    return records


def resolve_aggregate_rows(rows: list[SourceRow], table_name: str) -> list[SourceRow]:
    """Prefer a supplied aggregate over team stints, never both."""
    by_season: dict[str, list[SourceRow]] = defaultdict(list)
    for row in rows:
        by_season[row.values["Season"]].append(row)
    resolved: list[SourceRow] = []
    for season, group in by_season.items():
        aggregates = [row for row in group if row.values["Team"] in AGGREGATE_TEAMS]
        if len(aggregates) > 1:
            raise ValueError(f"{table_name}: multiple aggregate rows for {season}")
        resolved.extend(aggregates or group)
    return resolved


def source_key(row: SourceRow, season_type: str) -> tuple[str, str, str, str]:
    return (PLAYER_ID, row.values["Season"], season_type, row.values["Team"])


def index_rows(rows: list[SourceRow], table_name: str, season_type: str) -> dict[tuple[str, str, str, str], SourceRow]:
    indexed: dict[tuple[str, str, str, str], SourceRow] = {}
    for row in resolve_aggregate_rows(rows, table_name):
        key = source_key(row, season_type)
        if key in indexed:
            raise ValueError(f"{table_name}: duplicate explicit key {key}")
        indexed[key] = row
    return indexed


def validate_metadata(rows: tuple[SourceRow, SourceRow, SourceRow], key: tuple[str, str, str, str]) -> None:
    per_game, per_100, advanced = rows
    for column in ("Season", "Age", "Team", "Lg", "G", "GS"):
        values = {row.values[column] for row in rows}
        if len(values) != 1:
            raise ValueError(f"{key}: metadata disagreement for {column}: {sorted(values)}")
    if per_100.values["MP"] != advanced.values["MP"]:
        raise ValueError(f"{key}: Per 100 MP and Advanced MP disagree")
    if per_game.values["Lg"] not in {LEAGUE, "Did"}:
        raise ValueError(f"{key}: unexpected league {per_game.values['Lg']!r}")


def joined_record(
    key: tuple[str, str, str, str],
    per_game: SourceRow,
    per_100: SourceRow,
    advanced: SourceRow,
) -> dict[str, str]:
    validate_metadata((per_game, per_100, advanced), key)
    _, season, season_type, team = key
    sources = (per_game, per_100, advanced)
    placeholder = all(
        row.values[column] == "Did"
        for row, table_type in zip(sources, ("per_game", "per_100", "advanced"), strict=True)
        for column in TABLE_COLUMNS[table_type]
        if column != "Season"
    )
    if placeholder:
        if season_type != "regular_season" or season != "2021-22":
            raise ValueError(f"{key}: unexpected Did placeholder")
        return {
            "player_id": PLAYER_ID,
            "player_name": PLAYER_NAME,
            "season": season,
            "season_start": season[:4],
            "season_type": season_type,
            "source_team": "LAC",
            "season_age": "30",
            "games": "0",
            "starts": "0",
            "minutes_per_game": "",
            "total_minutes": "0",
            "points_per_game": "",
            "points_per_100": "",
            "assists_per_100": "",
            "ts_pct": "",
            "usage_pct": "",
            "turnover_pct": "",
            "appearance_status": "confirmed_no_appearance",
            "source_filenames": "|".join(row.filename for row in sources),
            "original_row_identifiers": "|".join(row.row_id for row in sources),
            "data_basis": "All three supplied regular-season rows use Did placeholders; treated as confirmed season-long nonparticipation.",
        }

    required = (
        (per_game, ("Age", "G", "GS", "MP", "PTS")),
        (per_100, ("MP", "PTS", "AST")),
        (advanced, ("MP", "TS%", "USG%", "TOV%")),
    )
    for row, columns in required:
        for column in columns:
            if not row.values[column]:
                raise ValueError(f"{row.row_id}: missing {column}")
            decimal(row.values[column], f"{row.row_id} {column}")
    games = decimal(per_game.values["G"], f"{key} games")
    total_minutes = decimal(per_100.values["MP"], f"{key} total minutes")
    mpg = decimal(per_game.values["MP"], f"{key} MPG")
    if games <= 0:
        raise ValueError(f"{key}: observed row must have positive games")
    if abs(total_minutes / games - mpg) > Decimal("0.11"):
        raise ValueError(f"{key}: total minutes / games does not agree with MPG within source rounding")

    return {
        "player_id": PLAYER_ID,
        "player_name": PLAYER_NAME,
        "season": season,
        "season_start": season[:4],
        "season_type": season_type,
        "source_team": team,
        "season_age": per_game.values["Age"],
        "games": per_game.values["G"],
        "starts": per_game.values["GS"],
        "minutes_per_game": per_game.values["MP"],
        "total_minutes": per_100.values["MP"],
        "points_per_game": per_game.values["PTS"],
        "points_per_100": per_100.values["PTS"],
        "assists_per_100": per_100.values["AST"],
        "ts_pct": normalize_fraction(advanced.values["TS%"], f"{advanced.row_id} TS%"),
        "usage_pct": advanced.values["USG%"],
        "turnover_pct": advanced.values["TOV%"],
        "appearance_status": "appeared",
        "source_filenames": "|".join(row.filename for row in sources),
        "original_row_identifiers": "|".join(row.row_id for row in sources),
        "data_basis": "One-to-one join of supplied Per Game, Per 100 Possessions and Advanced rows.",
    }


def prepare_season_type(raw_dir: Path, season_type: str) -> list[dict[str, str]]:
    tables = {}
    for table_type, filename in FILES[season_type].items():
        rows = read_source(raw_dir / filename, table_type)
        tables[table_type] = index_rows(rows, filename, season_type)
    key_sets = {name: set(rows) for name, rows in tables.items()}
    if len({frozenset(keys) for keys in key_sets.values()}) != 1:
        union = set().union(*key_sets.values())
        detail = {name: sorted(union - keys) for name, keys in key_sets.items()}
        raise ValueError(f"{season_type}: incomplete one-to-one join: {detail}")
    return [
        joined_record(key, tables["per_game"][key], tables["per_100"][key], tables["advanced"][key])
        for key in sorted(key_sets["per_game"], key=lambda item: (int(item[1][:4]), item[3]))
    ]


def missing_postseason_record() -> dict[str, str]:
    filenames = [FILES["postseason"][name] for name in ("per_game", "per_100", "advanced")]
    return {
        "player_id": PLAYER_ID,
        "player_name": PLAYER_NAME,
        "season": "2021-22",
        "season_start": "2021",
        "season_type": "postseason",
        "source_team": "LAC",
        "season_age": "30",
        "games": "",
        "starts": "",
        "minutes_per_game": "",
        "total_minutes": "",
        "points_per_game": "",
        "points_per_100": "",
        "assists_per_100": "",
        "ts_pct": "",
        "usage_pct": "",
        "turnover_pct": "",
        "appearance_status": "no_source_row",
        "source_filenames": "|".join(filenames),
        "original_row_identifiers": "",
        "data_basis": "No 2021-22 row appears in any supplied postseason table; no games value or cause inferred.",
    }


def prepare(raw_dir: Path) -> list[dict[str, str]]:
    rows = prepare_season_type(raw_dir, "regular_season")
    postseason = prepare_season_type(raw_dir, "postseason")
    if any(row["season"] == "2021-22" for row in postseason):
        raise ValueError("postseason: unexpected supplied 2021-22 row")
    postseason.append(missing_postseason_record())
    rows.extend(postseason)
    keys = [(row["player_id"], row["season"], row["season_type"], row["source_team"]) for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("normalized output contains duplicate explicit keys")
    return sorted(rows, key=lambda row: (int(row["season_start"]), row["season_type"], row["source_team"]))


def validate_check_values(rows: list[dict[str, str]]) -> None:
    expected = {
        ("2018-19", "regular_season"): ("60", "2040", "34.0", "26.6", "37.5", "0.606", "30.3"),
        ("2024-25", "regular_season"): ("37", "1180", "31.9", "21.5", "33.2", "0.589", "27.7"),
        ("2025-26", "regular_season"): ("65", "2085", "32.1", "27.9", "43.3", "0.629", "33.5"),
    }
    by_key = {(row["season"], row["season_type"]): row for row in rows}
    fields = ("games", "total_minutes", "minutes_per_game", "points_per_game", "points_per_100", "ts_pct", "usage_pct")
    for key, values in expected.items():
        actual = tuple(by_key[key][field] for field in fields)
        if actual != values:
            raise ValueError(f"check values failed for {key}: {actual} != {values}")
    playoff_expected = {
        "2018-19": ("24", "939", "39.2", "0.619"),
        "2019-20": ("13", "511", "35.2", "0.593"),
        "2020-21": ("11", "432", "40.0", "0.679"),
        "2022-23": ("2", "80", "41.9", "0.670"),
        "2023-24": ("2", "59", "21.5", "0.474"),
        "2024-25": ("7", "265", "34.4", "0.630"),
    }
    for season, values in playoff_expected.items():
        row = by_key[(season, "postseason")]
        actual = tuple(row[field] for field in ("games", "total_minutes", "points_per_100", "ts_pct"))
        if actual != values:
            raise ValueError(f"playoff check values failed for {season}: {actual} != {values}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/kawhi-leonard-production-availability.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    validate_check_values(rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} normalized records to {args.output}")
    print("PASS: unique explicit keys, complete joins, metadata agreement and Per 100/Advanced minutes agreement")
    print("PASS: MPG rounding checks, Did placeholder treatment, postseason gaps and requested check values")


if __name__ == "__main__":
    main()
