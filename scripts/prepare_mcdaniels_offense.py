"""Normalize Jaden McDaniels regular-season and postseason source tables.

Source: the six supplied Basketball Reference CSV exports in assets/data/raw.
Per-game MP is minutes per game; per-100 and advanced MP are total minutes.
P100P counting statistics are per 100 possessions. Shooting percentages are
fractions, while USG%, TRB%, AST%, and TOV% are percentage-point values.
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path


PLAYER_ID = "jaden_mcdaniels"
PLAYER_NAME = "Jaden McDaniels"
LEAGUE = "NBA"
EXPECTED_TEAM = "MIN"
REGULAR_SEASONS = tuple(f"{year}-{str(year + 1)[-2:]}" for year in range(2020, 2026))
POSTSEASONS = ("2021-22", "2023-24", "2024-25", "2025-26")
FILES = {
    "Regular season": {
        "avg": "McDanielsRegSeasonAvg.csv",
        "p100": "McDanielsRegSeasonP100P.csv",
        "adv": "McDanielsRegSeasonAdv.csv",
    },
    "Playoffs": {
        "avg": "McDanielsPostseasonAvg.csv",
        "p100": "McDanielsPostseasonP100P.csv",
        "adv": "McDanielsPostseasonAdv.csv",
    },
}
IDENTITY_COLUMNS = ("Season", "Age", "Team", "Lg", "Pos", "G", "GS")
REQUIRED_COLUMNS = {
    "avg": IDENTITY_COLUMNS + ("MP", "PTS", "TRB", "AST"),
    "p100": IDENTITY_COLUMNS + ("MP", "PTS", "TRB", "AST", "FGA", "3PA", "TOV", "3P%"),
    "adv": IDENTITY_COLUMNS + ("MP", "TS%", "USG%", "TRB%", "AST%", "TOV%"),
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
    "rebounds_per_game",
    "assists_per_game",
    "points_per_100",
    "rebounds_per_100",
    "assists_per_100",
    "fga_per_100",
    "fg3a_per_100",
    "turnovers_per_100",
    "ts_pct",
    "usage_pct",
    "fg3_pct",
    "total_rebound_pct",
    "assist_pct",
    "turnover_pct",
    "avg_source_file",
    "avg_source_row_id",
    "p100_source_file",
    "p100_source_row_id",
    "adv_source_file",
    "adv_source_row_id",
)


class PreparationError(ValueError):
    """Raised when the supplied tables cannot be joined without ambiguity."""


def decimal_text(value: str, *, fraction: bool = False, location: str) -> str:
    """Validate finite source numerics while preserving source precision."""
    text = value.strip()
    if text == "":
        return ""
    try:
        parsed = Decimal(text)
    except InvalidOperation as error:
        raise PreparationError(f"{location}: invalid numeric value {value!r}.") from error
    if not parsed.is_finite():
        raise PreparationError(f"{location}: non-finite numeric value {value!r}.")
    if fraction and text.startswith("."):
        return f"0{text}"
    if fraction and text.startswith("-."):
        return f"-0{text[1:]}"
    return text


def choose_season_row(
    rows: list[dict[str, str]], *, path: Path, season: str
) -> dict[str, str]:
    """Select one season row without mixing aggregate and constituent stints."""
    if len(rows) == 1:
        return rows[0]
    aggregate_rows = [row for row in rows if row["Team"] in {"TOT", "2TM", "3TM", "4TM"}]
    if len(aggregate_rows) == 1:
        return aggregate_rows[0]
    teams = [row["Team"] for row in rows]
    raise PreparationError(
        f"{path.name} {season}: ambiguous rows for teams {teams}; "
        "rates cannot be averaged across constituent stints."
    )


def read_table(
    path: Path, *, table: str, season_type: str, expected_seasons: tuple[str, ...]
) -> dict[tuple[str, str, str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))
    if not raw_rows:
        raise PreparationError(f"{path.name}: empty source file.")

    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == "Season"),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: could not find the table header.")
    header = [cell.strip() for cell in raw_rows[header_index]]
    if len(header) != len(set(header)):
        raise PreparationError(f"{path.name}: duplicate leaf headers are ambiguous.")
    missing_columns = [column for column in REQUIRED_COLUMNS[table] if column not in header]
    if missing_columns:
        raise PreparationError(f"{path.name}: missing columns {missing_columns}.")

    candidates: dict[str, list[dict[str, str]]] = defaultdict(list)
    for line_number, values in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        if len(values) != len(header):
            raise PreparationError(
                f"{path.name}:{line_number}: expected {len(header)} fields, found {len(values)}."
            )
        row = dict(zip(header, (cell.strip() for cell in values), strict=True))
        season = row["Season"]
        if season in {"", "Season", "Career"} or season not in expected_seasons:
            continue
        row["_source_row_id"] = f"{path.name}:{line_number}"
        candidates[season].append(row)

    if set(candidates) != set(expected_seasons):
        raise PreparationError(
            f"{path.name}: expected seasons {expected_seasons}, found {tuple(sorted(candidates))}."
        )

    records: dict[tuple[str, str, str, str], dict[str, str]] = {}
    for season in expected_seasons:
        row = choose_season_row(candidates[season], path=path, season=season)
        for column in REQUIRED_COLUMNS[table]:
            if row[column] == "":
                raise PreparationError(f"{row['_source_row_id']}: missing required {column}.")
        if row["Lg"] != LEAGUE:
            raise PreparationError(f"{row['_source_row_id']}: expected league {LEAGUE}.")
        key = (PLAYER_ID, season, season_type, row["Team"])
        if key in records:
            raise PreparationError(f"{row['_source_row_id']}: duplicate key {key}.")
        records[key] = row
    return records


def require_agreement(
    rows: tuple[dict[str, str], dict[str, str], dict[str, str]], *, location: str
) -> None:
    avg, p100, adv = rows
    conflicts = {
        column: (avg[column], p100[column], adv[column])
        for column in IDENTITY_COLUMNS
        if len({avg[column], p100[column], adv[column]}) != 1
    }
    if conflicts:
        raise PreparationError(f"{location}: source metadata conflict {conflicts}.")
    if p100["MP"] != adv["MP"]:
        raise PreparationError(f"{location}: P100P and Advanced total minutes disagree.")

    games = Decimal(avg["G"])
    minutes_per_game = Decimal(avg["MP"])
    total_minutes = Decimal(p100["MP"])
    if games <= 0 or abs(total_minutes / games - minutes_per_game) > Decimal("0.051"):
        raise PreparationError(
            f"{location}: total minutes / games does not match MPG within rounding tolerance."
        )


def prepare(raw_dir: Path) -> list[dict[str, str]]:
    output: list[dict[str, str]] = []
    for season_type, file_map in FILES.items():
        expected_seasons = REGULAR_SEASONS if season_type == "Regular season" else POSTSEASONS
        tables = {
            table: read_table(
                raw_dir / filename,
                table=table,
                season_type=season_type,
                expected_seasons=expected_seasons,
            )
            for table, filename in file_map.items()
        }
        key_sets = {table: set(records) for table, records in tables.items()}
        if len({frozenset(keys) for keys in key_sets.values()}) != 1:
            raise PreparationError(
                f"{season_type}: one-to-one join failure; "
                + "; ".join(f"{table}={sorted(keys)}" for table, keys in key_sets.items())
            )

        for key in sorted(key_sets["avg"], key=lambda item: int(item[1][:4])):
            avg, p100, adv = (tables[table][key] for table in ("avg", "p100", "adv"))
            location = f"{season_type} {key[1]} {key[3]}"
            require_agreement((avg, p100, adv), location=location)
            if key[3] != EXPECTED_TEAM:
                raise PreparationError(f"{location}: unexpected source team for {PLAYER_NAME}.")

            record = {
                "player_id": PLAYER_ID,
                "player_name": PLAYER_NAME,
                "season": key[1],
                "season_start": key[1][:4],
                "season_type": season_type,
                "source_team": key[3],
                "season_age": decimal_text(avg["Age"], location=f"{location} age"),
                "games": decimal_text(avg["G"], location=f"{location} games"),
                "starts": decimal_text(avg["GS"], location=f"{location} starts"),
                "minutes_per_game": decimal_text(avg["MP"], location=f"{location} MPG"),
                "total_minutes": decimal_text(p100["MP"], location=f"{location} minutes"),
                "points_per_game": decimal_text(avg["PTS"], location=f"{location} PPG"),
                "rebounds_per_game": decimal_text(avg["TRB"], location=f"{location} RPG"),
                "assists_per_game": decimal_text(avg["AST"], location=f"{location} APG"),
                "points_per_100": decimal_text(p100["PTS"], location=f"{location} PTS/100"),
                "rebounds_per_100": decimal_text(p100["TRB"], location=f"{location} REB/100"),
                "assists_per_100": decimal_text(p100["AST"], location=f"{location} AST/100"),
                "fga_per_100": decimal_text(p100["FGA"], location=f"{location} FGA/100"),
                "fg3a_per_100": decimal_text(p100["3PA"], location=f"{location} 3PA/100"),
                "turnovers_per_100": decimal_text(p100["TOV"], location=f"{location} TOV/100"),
                "ts_pct": decimal_text(adv["TS%"], fraction=True, location=f"{location} TS%"),
                "usage_pct": decimal_text(adv["USG%"], location=f"{location} USG%"),
                "fg3_pct": decimal_text(p100["3P%"], fraction=True, location=f"{location} 3P%"),
                "total_rebound_pct": decimal_text(adv["TRB%"], location=f"{location} TRB%"),
                "assist_pct": decimal_text(adv["AST%"], location=f"{location} AST%"),
                "turnover_pct": decimal_text(adv["TOV%"], location=f"{location} TOV%"),
                "avg_source_file": file_map["avg"],
                "avg_source_row_id": avg["_source_row_id"],
                "p100_source_file": file_map["p100"],
                "p100_source_row_id": p100["_source_row_id"],
                "adv_source_file": file_map["adv"],
                "adv_source_row_id": adv["_source_row_id"],
            }
            if set(record) != set(OUTPUT_COLUMNS):
                raise PreparationError(f"{location}: normalized schema mismatch.")
            output.append(record)

    validate_output(output)
    return sorted(output, key=lambda row: (int(row["season_start"]), row["season_type"] != "Regular season"))


def validate_output(rows: list[dict[str, str]]) -> None:
    if len(rows) != 10:
        raise PreparationError(f"Expected 10 normalized rows, found {len(rows)}.")
    keys = {
        (row["player_id"], row["season"], row["season_type"], row["source_team"])
        for row in rows
    }
    if len(keys) != len(rows):
        raise PreparationError("Normalized join keys are not unique.")

    fractions = ("ts_pct", "fg3_pct")
    percentage_points = ("usage_pct", "total_rebound_pct", "assist_pct", "turnover_pct")
    numeric_fields = OUTPUT_COLUMNS[6:26]
    for row in rows:
        for field in numeric_fields:
            if row[field] == "":
                continue
            value = Decimal(row[field])
            if not value.is_finite():
                raise PreparationError(f"{row['season']} {row['season_type']}: non-finite {field}.")
        for field in fractions:
            if row[field] != "" and not Decimal("0") <= Decimal(row[field]) <= Decimal("1"):
                raise PreparationError(f"{row['season']} {row['season_type']}: invalid {field} fraction.")
        for field in percentage_points:
            if row[field] != "" and not Decimal("0") <= Decimal(row[field]) <= Decimal("100"):
                raise PreparationError(f"{row['season']} {row['season_type']}: invalid {field} value.")

    regular = [row for row in rows if row["season_type"] == "Regular season"]
    playoffs = [row for row in rows if row["season_type"] == "Playoffs"]
    if tuple(row["season"] for row in regular) != REGULAR_SEASONS:
        raise PreparationError("Regular-season coverage is incomplete.")
    if tuple(row["season"] for row in playoffs) != POSTSEASONS:
        raise PreparationError("Postseason coverage is incomplete.")

    by_key = {(row["season"], row["season_type"]): row for row in rows}
    expected = {
        ("2024-25", "Regular season"): ("18.9", "0.562", "16.3", "82"),
        ("2024-25", "Playoffs"): ("22.3", "0.607", "17.4", "15"),
        ("2025-26", "Regular season"): ("22.3", "0.611", "18.5", "73"),
        ("2025-26", "Playoffs"): ("23.2", "0.512", "21.3", "12"),
    }
    for key, values in expected.items():
        row = by_key[key]
        actual = (row["points_per_100"], row["ts_pct"], row["usage_pct"], row["games"])
        if actual != values:
            raise PreparationError(f"Check values failed for {key}: {actual} != {values}.")
    latest_support = {
        "Regular season": ("16.7", "5.2", "0.412"),
        "Playoffs": ("20.8", "5.0", "0.238"),
    }
    for season_type, values in latest_support.items():
        row = by_key[("2025-26", season_type)]
        actual = (row["fga_per_100"], row["fg3a_per_100"], row["fg3_pct"])
        if actual != values:
            raise PreparationError(f"Latest supporting fields failed for {season_type}.")
    playoff_samples = {
        "2021-22": ("6", "130"),
        "2023-24": ("16", "537"),
        "2024-25": ("15", "497"),
        "2025-26": ("12", "406"),
    }
    for season, values in playoff_samples.items():
        row = by_key[(season, "Playoffs")]
        if (row["games"], row["total_minutes"]) != values:
            raise PreparationError(f"Playoff sample failed for {season}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/mcdaniels-offense-2020-2026.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} validated player-season-season_type rows to {args.output}")
    print("Validated unique explicit join keys and one-to-one Avg/P100P/Advanced joins.")
    print("Validated source metadata, total minutes, MPG tolerance, units, and supplied checks.")


if __name__ == "__main__":
    main()
