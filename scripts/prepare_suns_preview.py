"""Prepare the three Phoenix Suns season-preview graphics.

The raw Basketball-Reference exports are preserved. This transformation
resolves grouped headers and repeated embedded headers, joins player tables on
stable player ID plus season, separates completed seasons from the supplied
2026-27 snapshot, validates the frozen windows, and writes chart-ready CSVs.
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "assets" / "data" / "raw" / "PHO"
PROCESSED_DIR = ROOT / "assets" / "data" / "processed"

ROOKIE_ID = "-9999"
GREEN_ID = "greenja05"
ROOKIE_SEASONS = tuple(f"{year}-{str(year + 1)[2:]}" for year in range(2020, 2026))
PAIR_ROOKIE_SEASONS = ("2020-21", "2021-22", "2022-23")
GREEN_SEASONS = ("2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27")
BOOKER_SEASONS = ("2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27")


class PreparationError(RuntimeError):
    """Raised when a source or validation rule prevents a truthful output."""


def decimal(value: str, location: str) -> Decimal:
    value = value.strip()
    if not value:
        raise PreparationError(f"Missing numeric value at {location}.")
    try:
        result = Decimal(value)
    except InvalidOperation as error:
        raise PreparationError(f"Invalid numeric value at {location}: {value!r}.") from error
    if not result.is_finite():
        raise PreparationError(f"Non-finite numeric value at {location}: {value!r}.")
    return result


def integer(value: str, location: str) -> int:
    result = decimal(value, location)
    if result != result.to_integral_value():
        raise PreparationError(f"Expected integer at {location}, found {value!r}.")
    return int(result)


def one_decimal(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.1')):.1f}"


def unique_headers(header: list[str]) -> list[str]:
    counts: Counter[str] = Counter()
    output: list[str] = []
    for raw_name in header:
        name = raw_name.strip()
        counts[name] += 1
        output.append(name if counts[name] == 1 else f"{name}__{counts[name]}")
    return output


def read_table(path: Path, header_first_cell: str) -> tuple[list[dict[str, str]], list[str], int]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))
    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == header_first_cell),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: could not find header beginning {header_first_cell!r}.")
    raw_header = [cell.strip() for cell in raw_rows[header_index]]
    header = unique_headers(raw_header)
    rows: list[dict[str, str]] = []
    repeated_headers = 0
    for line_number, values in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        cleaned = [cell.strip() for cell in values]
        if cleaned == raw_header:
            repeated_headers += 1
            continue
        if len(cleaned) == len(header) - 1 and header[-1] == "Awards":
            cleaned.append("")
        if len(cleaned) != len(header):
            raise PreparationError(
                f"{path.name}:{line_number}: expected {len(header)} fields, found {len(cleaned)}."
            )
        row = dict(zip(header, cleaned, strict=True))
        row["source_line"] = str(line_number)
        rows.append(row)
    return rows, header, repeated_headers


def index_unique(
    rows: list[dict[str, str]], fields: tuple[str, ...], *, source: str
) -> dict[tuple[str, ...], dict[str, str]]:
    output: dict[tuple[str, ...], dict[str, str]] = {}
    for row in rows:
        key = tuple(row.get(field, "") for field in fields)
        if not all(key):
            raise PreparationError(f"{source}: blank key {key}.")
        if key in output:
            raise PreparationError(f"{source}: duplicate key {key}.")
        output[key] = row
    return output


def comparison_season(rookie_season: str) -> str:
    start = int(rookie_season[:4]) + 3
    return f"{start}-{str(start + 1)[2:]}"


def prepare_rookie_change(raw_dir: Path) -> list[dict[str, str]]:
    rookie_path = raw_dir / "JalenGreen" / "AllRookieTeamMembers_RookieSeason_PerGame.csv"
    post_path = raw_dir / "JalenGreen" / "AllRookies_2ndThrough6thSeason_PerGame.csv"
    rookie_rows, rookie_header, rookie_repeats = read_table(rookie_path, "Rk")
    post_rows, post_header, post_repeats = read_table(post_path, "Rk")
    required = {"Player", "Season", "Team", "G", "MP", "PTS", "TS%", ROOKIE_ID}
    for path, header in ((rookie_path, rookie_header), (post_path, post_header)):
        missing = sorted(required - set(header))
        if missing:
            raise PreparationError(f"{path.name}: missing required fields {missing}.")
    if rookie_repeats != 0 or post_repeats != 5:
        raise PreparationError(
            f"Unexpected embedded header counts: rookie={rookie_repeats}, post-rookie={post_repeats}."
        )
    rookie_index = index_unique(rookie_rows, (ROOKIE_ID, "Season"), source=rookie_path.name)
    if len(rookie_index) != 60:
        raise PreparationError(f"Expected 60 All-Rookie rows, found {len(rookie_index)}.")
    rookie_counts = Counter(row["Season"] for row in rookie_rows)
    if dict(sorted(rookie_counts.items())) != {season: 10 for season in ROOKIE_SEASONS}:
        raise PreparationError(f"Unexpected All-Rookie season counts: {dict(rookie_counts)}.")

    rookie_ids = {player_id for player_id, _ in rookie_index}
    matched_post = [row for row in post_rows if row[ROOKIE_ID] in rookie_ids]
    post_index = index_unique(matched_post, (ROOKIE_ID, "Season"), source=post_path.name)
    represented = {player_id for player_id, _ in post_index}
    missing_ids = rookie_ids - represented
    if len(matched_post) != 194 or len(represented) != 59:
        raise PreparationError(
            f"Expected 194 matched post-rookie rows for 59 players, found "
            f"{len(matched_post)} rows for {len(represented)} players."
        )
    if missing_ids != {"raynama01"}:
        raise PreparationError(f"Unexpected post-rookie unmatched IDs: {sorted(missing_ids)}.")

    output: list[dict[str, str]] = []
    for rookie_season in PAIR_ROOKIE_SEASONS:
        for (player_id, season), rookie in rookie_index.items():
            if season != rookie_season:
                continue
            target = comparison_season(season)
            comparison = post_index.get((player_id, target))
            if comparison is None:
                raise PreparationError(f"Missing comparison season for {(player_id, season)} -> {target}.")
            rookie_ts = decimal(rookie["TS%"], f"{player_id} {season} rookie TS%")
            comparison_ts = decimal(comparison["TS%"], f"{player_id} {target} comparison TS%")
            if not Decimal("0") <= rookie_ts <= Decimal("1") or not Decimal("0") <= comparison_ts <= Decimal("1"):
                raise PreparationError(f"{player_id}: TS% is not stored as a fraction.")
            output.append(
                {
                    "player_id": player_id,
                    "player_name": rookie["Player"],
                    "rookie_season": season,
                    "comparison_season": target,
                    "rookie_team": rookie["Team"],
                    "comparison_team": comparison["Team"],
                    "rookie_games": str(integer(rookie["G"], f"{player_id} rookie games")),
                    "comparison_games": str(integer(comparison["G"], f"{player_id} comparison games")),
                    "rookie_minutes_per_game": one_decimal(decimal(rookie["MP"], f"{player_id} rookie MPG")),
                    "comparison_minutes_per_game": one_decimal(decimal(comparison["MP"], f"{player_id} comparison MPG")),
                    "rookie_points_per_game": one_decimal(decimal(rookie["PTS"], f"{player_id} rookie PPG")),
                    "comparison_points_per_game": one_decimal(decimal(comparison["PTS"], f"{player_id} comparison PPG")),
                    "points_per_game_change": one_decimal(
                        decimal(comparison["PTS"], f"{player_id} comparison PPG")
                        - decimal(rookie["PTS"], f"{player_id} rookie PPG")
                    ),
                    "rookie_true_shooting_pct": rookie["TS%"],
                    "comparison_true_shooting_pct": comparison["TS%"],
                    "true_shooting_pct_point_change": one_decimal((comparison_ts - rookie_ts) * 100),
                    "is_jalen_green": "true" if player_id == GREEN_ID else "false",
                    "rookie_source_line": rookie["source_line"],
                    "comparison_source_line": comparison["source_line"],
                }
            )
    output.sort(key=lambda row: (row["player_name"].casefold(), row["player_id"]))
    if len(output) != 30 or len({row["player_id"] for row in output}) != 30:
        raise PreparationError("The three-calendar-year cohort is not 30 unique players.")
    ppg_changes = sorted(decimal(row["points_per_game_change"], "PPG change") for row in output)
    ts_changes = sorted(decimal(row["true_shooting_pct_point_change"], "TS change") for row in output)
    ppg_median = (ppg_changes[14] + ppg_changes[15]) / 2
    ts_median = (ts_changes[14] + ts_changes[15]) / 2
    if ppg_median != Decimal("3.0") or ts_median != Decimal("1.9"):
        raise PreparationError(f"Cohort medians changed: {ppg_median} PPG, {ts_median} TS points.")
    green = next(row for row in output if row["player_id"] == GREEN_ID)
    green_anchor = (
        green["rookie_points_per_game"], green["rookie_true_shooting_pct"], green["rookie_games"],
        green["comparison_points_per_game"], green["comparison_true_shooting_pct"], green["comparison_games"],
        green["points_per_game_change"], green["true_shooting_pct_point_change"],
    )
    expected = ("17.3", ".547", "67", "21.0", ".544", "82", "3.7", "-0.3")
    if green_anchor != expected:
        raise PreparationError(f"Jalen Green comparison anchor changed: {green_anchor}.")
    return output


def season_tables(paths: dict[str, Path], expected: tuple[str, ...]) -> dict[str, dict[str, dict[str, str]]]:
    output: dict[str, dict[str, dict[str, str]]] = {}
    for name, path in paths.items():
        rows, _, repeats = read_table(path, "Season")
        if repeats:
            raise PreparationError(f"{path.name}: unexpected repeated header rows ({repeats}).")
        indexed = index_unique(rows, ("Season",), source=path.name)
        selected = {season: indexed[(season,)] for season in expected if (season,) in indexed}
        if set(selected) != set(expected):
            raise PreparationError(f"{path.name}: season coverage is {sorted(selected)}, expected {list(expected)}.")
        output[name] = selected
    return output


def validate_player_join(
    player: str, season: str, rows: dict[str, dict[str, str]], *, total_minute_tables: tuple[str, ...]
) -> None:
    for field in ("Age", "Team", "Lg", "Pos", "G", "GS"):
        values = {row[field] for row in rows.values()}
        if len(values) != 1:
            raise PreparationError(f"{player} {season}: {field} disagrees across sources: {values}.")
    minutes = {rows[name]["MP"] for name in total_minute_tables}
    if len(minutes) != 1:
        raise PreparationError(f"{player} {season}: total minutes disagree: {minutes}.")
    # Per-game MP is intentionally excluded: it is minutes per game.


def prepare_green_career(raw_dir: Path) -> list[dict[str, str]]:
    base = raw_dir / "JalenGreen"
    tables = season_tables(
        {
            "adjusted": base / "Green_AdjShooting.csv",
            "advanced": base / "Green_Adv.csv",
            "per100": base / "Green_P100P.csv",
        },
        GREEN_SEASONS,
    )
    output: list[dict[str, str]] = []
    for season in GREEN_SEASONS:
        rows = {name: table[season] for name, table in tables.items()}
        validate_player_join("Jalen Green", season, rows, total_minute_tables=("adjusted", "advanced", "per100"))
        if rows["adjusted"]["TS%"] != rows["advanced"]["TS%"]:
            raise PreparationError(f"Jalen Green {season}: TS% disagrees between adjusted and advanced tables.")
        ts = decimal(rows["adjusted"]["TS%"], f"Green {season} TS%")
        if not Decimal("0") <= ts <= Decimal("1"):
            raise PreparationError(f"Green {season}: TS% is not a fraction.")
        output.append(
            {
                "season": season,
                "sample_status": "current_13_games" if season == "2026-27" else "completed",
                "team": rows["adjusted"]["Team"],
                "games": rows["adjusted"]["G"],
                "total_minutes": rows["adjusted"]["MP"],
                "true_shooting_pct": rows["adjusted"]["TS%"],
                "true_shooting_plus": rows["adjusted"]["TS+"],
                "points_per_100": rows["per100"]["PTS"],
                "adjusted_source_line": rows["adjusted"]["source_line"],
                "advanced_source_line": rows["advanced"]["source_line"],
                "per100_source_line": rows["per100"]["source_line"],
            }
        )
    completed_ts_plus = tuple(row["true_shooting_plus"] for row in output[:-1])
    if completed_ts_plus != ("97", "93", "93", "94", "89"):
        raise PreparationError(f"Green completed-season TS+ anchors changed: {completed_ts_plus}.")
    current = output[-1]
    if (
        current["games"], current["true_shooting_pct"], current["true_shooting_plus"], current["points_per_100"]
    ) != ("13", ".499", "87", "21.8"):
        raise PreparationError("Green current 13-game anchor changed.")
    return output


def prepare_booker_career(raw_dir: Path) -> list[dict[str, str]]:
    base = raw_dir / "Booker"
    tables = season_tables(
        {
            "adjusted": base / "Booker_AdjShooting.csv",
            "advanced": base / "Booker_Adv.csv",
            "per100": base / "Booker_P100P.csv",
            "per_game": base / "Booker_PerGame.csv",
        },
        BOOKER_SEASONS,
    )
    output: list[dict[str, str]] = []
    for season in BOOKER_SEASONS:
        rows = {name: table[season] for name, table in tables.items()}
        validate_player_join("Devin Booker", season, rows, total_minute_tables=("adjusted", "advanced", "per100"))
        if rows["adjusted"]["TS%"] != rows["advanced"]["TS%"]:
            raise PreparationError(f"Booker {season}: TS% disagrees between adjusted and advanced tables.")
        ts = decimal(rows["adjusted"]["TS%"], f"Booker {season} TS%")
        if not Decimal("0") <= ts <= Decimal("1"):
            raise PreparationError(f"Booker {season}: TS% is not a fraction.")
        decimal(rows["per_game"]["MP"], f"Booker {season} MPG")
        output.append(
            {
                "season": season,
                "sample_status": "current_13_games" if season == "2026-27" else "completed",
                "team": rows["adjusted"]["Team"],
                "games": rows["adjusted"]["G"],
                "total_minutes": rows["adjusted"]["MP"],
                "minutes_per_game": rows["per_game"]["MP"],
                "points_per_100": rows["per100"]["PTS"],
                "assists_per_100": rows["per100"]["AST"],
                "true_shooting_pct": rows["adjusted"]["TS%"],
                "true_shooting_plus": rows["adjusted"]["TS+"],
                "adjusted_source_line": rows["adjusted"]["source_line"],
                "advanced_source_line": rows["advanced"]["source_line"],
                "per100_source_line": rows["per100"]["source_line"],
                "per_game_source_line": rows["per_game"]["source_line"],
            }
        )
    anchors = {
        "2022-23": ("39.2", "7.8", "103"),
        "2023-24": ("36.7", "9.4", "105"),
        "2025-26": ("38.4", "8.9", "101"),
        "2026-27": ("35.3", "7.8", "105"),
    }
    for season, expected in anchors.items():
        row = next(item for item in output if item["season"] == season)
        actual = (row["points_per_100"], row["assists_per_100"], row["true_shooting_plus"])
        if actual != expected:
            raise PreparationError(f"Booker {season} anchor changed: {actual}.")
    current = output[-1]
    if (current["games"], current["true_shooting_pct"]) != ("13", ".605"):
        raise PreparationError("Booker current games or TS% anchor changed.")
    return output


def read_four_factors(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    if len(rows) < 4:
        raise PreparationError(f"{path.name}: incomplete four-factors export.")
    header = unique_headers(rows[1])
    if len(rows[2]) != len(header) or len(rows[3]) != len(header):
        raise PreparationError(f"{path.name}: Team/Lg Rank rows do not match the leaf header.")
    team = dict(zip(header, (value.strip() for value in rows[2]), strict=True))
    ranks = dict(zip(header, (value.strip() for value in rows[3]), strict=True))
    if team[""] != "Team" or ranks[""] != "Lg Rank":
        raise PreparationError(f"{path.name}: expected explicit Team and Lg Rank rows.")
    return team, ranks


def prepare_team(raw_dir: Path) -> list[dict[str, str]]:
    configs = (
        ("2025-26", "completed", "PHO_Team4Factors_2526.csv"),
        ("2026-27", "current_13_games", "PHO_Team4Factors_2627.csv"),
    )
    output: list[dict[str, str]] = []
    for season, status, filename in configs:
        folder = "202526" if season == "2025-26" else "202627"
        team, ranks = read_four_factors(raw_dir / folder / filename)
        wins = integer(team["W"], f"Phoenix {season} wins")
        losses = integer(team["L"], f"Phoenix {season} losses")
        row = {
            "season": season,
            "sample_status": status,
            "games": str(wins + losses),
            "wins": str(wins),
            "losses": str(losses),
            "defensive_rating": team["DRtg"],
            "defensive_rating_rank": ranks["DRtg"],
            "defensive_rebound_pct": team["DRB%"],
            "defensive_rebound_pct_rank": ranks["DRB%"],
            "offensive_rebound_pct": team["ORB%"],
            "offensive_rebound_pct_rank": ranks["ORB%"],
            "strength_of_schedule": team["SOS"],
            "strength_of_schedule_rank": ranks["SOS"],
            "simple_rating_system": team["SRS"],
            "simple_rating_system_rank": ranks["SRS"],
        }
        for field in ("defensive_rebound_pct", "offensive_rebound_pct"):
            value = decimal(row[field], f"Phoenix {season} {field}")
            if not Decimal("0") <= value <= Decimal("100"):
                raise PreparationError(f"Phoenix {season} {field} is not in percentage units.")
        output.append(row)
    anchors = {
        "2025-26": ("82", "45", "37", "113.9", "10", "71.9", "27", "28.9", "7"),
        "2026-27": ("13", "6", "7", "118.2", "24", "67.8", "30", "26.5", "19"),
    }
    for row in output:
        actual = (
            row["games"], row["wins"], row["losses"], row["defensive_rating"],
            row["defensive_rating_rank"], row["defensive_rebound_pct"],
            row["defensive_rebound_pct_rank"], row["offensive_rebound_pct"],
            row["offensive_rebound_pct_rank"],
        )
        if actual != anchors[row["season"]]:
            raise PreparationError(f"Phoenix {row['season']} team anchors changed: {actual}.")
    current = output[-1]
    if (current["strength_of_schedule_rank"], current["simple_rating_system_rank"]) != ("3", "15"):
        raise PreparationError("Current schedule-strength or SRS rank anchor changed.")
    return output


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        raise PreparationError(f"Refusing to write empty output {path}.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=tuple(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--output-dir", type=Path, default=PROCESSED_DIR)
    args = parser.parse_args()
    rookie_change = prepare_rookie_change(args.raw_dir)
    green_career = prepare_green_career(args.raw_dir)
    booker_career = prepare_booker_career(args.raw_dir)
    team = prepare_team(args.raw_dir)
    write_csv(args.output_dir / "suns-green-all-rookie-change.csv", rookie_change)
    write_csv(args.output_dir / "suns-green-career.csv", green_career)
    write_csv(args.output_dir / "suns-booker-career.csv", booker_career)
    write_csv(args.output_dir / "suns-team-defense-rebounding.csv", team)
    print("Wrote 30 Green cohort rows, 6 Green career rows, 8 Booker rows and 2 Phoenix team rows.")
    print("Validated stable-ID joins, embedded headers, percentage units, anchors and the frozen 13-game window.")


if __name__ == "__main__":
    main()
