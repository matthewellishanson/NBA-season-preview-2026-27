"""Prepare the three New Orleans Pelicans preview graphics.

Raw Basketball-Reference exports are preserved. This script resolves grouped
headers and duplicate leaf names explicitly, validates one-to-one rookie joins
on stable player ID plus season, and writes chart-ready CSVs for the browser.
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOKIE_SEASONS = ("2023-24", "2024-25", "2025-26")
EXPECTED_ROOKIE_COUNTS = {"2023-24": 43, "2024-25": 47, "2025-26": 48}
FEATURED_ROOKIES = {
    "fearsje01": {"name": "Jeremiah Fears", "minutes": 2112},
    "queende01": {"name": "Derik Queen", "minutes": 2023},
}
ZION_SEASONS = (
    "2019-20",
    "2020-21",
    "2021-22",
    "2022-23",
    "2023-24",
    "2024-25",
    "2025-26",
    "2026-27",
)


class PreparationError(RuntimeError):
    """Raised when a source or validation rule prevents a truthful output."""


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
        raise PreparationError(f"Expected integer at {location}, found {value!r}.")
    return int(number)


def decimal_text(value: Decimal) -> str:
    return format(value, "f")


def unique_headers(header: list[str]) -> list[str]:
    counts: Counter[str] = Counter()
    result: list[str] = []
    for raw_name in header:
        name = raw_name.strip()
        counts[name] += 1
        result.append(name if counts[name] == 1 else f"{name}__{counts[name]}")
    return result


def read_table(path: Path, first_header: str) -> tuple[list[dict[str, str]], list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        raw_rows = list(csv.reader(source))
    header_index = next(
        (index for index, row in enumerate(raw_rows) if row and row[0].strip() == first_header),
        None,
    )
    if header_index is None:
        raise PreparationError(f"{path.name}: could not find {first_header!r} header.")
    header = unique_headers(raw_rows[header_index])
    rows: list[dict[str, str]] = []
    for line_number, values in enumerate(raw_rows[header_index + 1 :], header_index + 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        if len(values) != len(header):
            raise PreparationError(
                f"{path.name}:{line_number}: expected {len(header)} fields, found {len(values)}."
            )
        row = dict(zip(header, (cell.strip() for cell in values), strict=True))
        row["_source_row"] = f"{path.as_posix()}:{line_number}"
        rows.append(row)
    return rows, header


def index_unique(
    rows: list[dict[str, str]], key_fields: tuple[str, ...], *, source: str
) -> dict[tuple[str, ...], dict[str, str]]:
    indexed: dict[tuple[str, ...], dict[str, str]] = {}
    for row in rows:
        key = tuple(row[field] for field in key_fields)
        if not all(key):
            raise PreparationError(f"{source}: blank join key {key}.")
        if key in indexed:
            raise PreparationError(f"{source}: duplicate key {key}.")
        indexed[key] = row
    return indexed


def read_rookie_source(path: Path, id_header: str) -> dict[tuple[str, str], dict[str, str]]:
    rows, header = read_table(path, "Rk")
    required = {
        "Player", "PTS/100 Poss.", "G", "G__2", "MP/G", "Season", "Team", id_header
    }
    missing = sorted(required - set(header))
    if missing:
        raise PreparationError(f"{path.name}: missing required fields {missing}.")
    selected: list[dict[str, str]] = []
    for row in rows:
        if row["Season"] not in ROOKIE_SEASONS:
            raise PreparationError(f"{row['_source_row']}: unexpected season {row['Season']!r}.")
        if row["G"] != row["G__2"]:
            raise PreparationError(f"{row['_source_row']}: repeated games columns disagree.")
        row["player_id"] = row[id_header]
        selected.append(row)
    indexed = index_unique(selected, ("player_id", "Season"), source=path.name)
    counts = Counter(season for _, season in indexed)
    if dict(counts) != EXPECTED_ROOKIE_COUNTS:
        raise PreparationError(f"{path.name}: season counts {dict(counts)} do not match expected.")
    return indexed


def prepare_rookies(raw_dir: Path) -> list[dict[str, str]]:
    sources = {
        "advanced": read_rookie_source(raw_dir / "Rookies_Adv_2023to26.csv", "Player-additional"),
        "per_100": read_rookie_source(raw_dir / "Rookies_P100P_2023to26.csv", "-9999"),
        "per_game": read_rookie_source(raw_dir / "Rookies_PerGame_2023to26.csv", "-9999"),
    }
    key_sets = {name: set(rows) for name, rows in sources.items()}
    if len({frozenset(keys) for keys in key_sets.values()}) != 1:
        union = set().union(*key_sets.values())
        details = {name: sorted(union - keys)[:8] for name, keys in key_sets.items()}
        raise PreparationError(f"Rookie tables have unmatched player-season keys: {details}.")

    output: list[dict[str, str]] = []
    for key in sorted(key_sets["advanced"], key=lambda item: (item[1], item[0])):
        rows = {name: table[key] for name, table in sources.items()}
        for field in ("Player", "Season", "Team", "G", "MP/G", "PTS/100 Poss."):
            values = {name: row[field] for name, row in rows.items()}
            if len(set(values.values())) != 1:
                raise PreparationError(f"{key}: {field} conflicts across rookie sources: {values}.")
        games = integer_value(rows["per_game"]["G"], location=f"{key} games")
        mpg = decimal_value(rows["per_game"]["MP/G"], location=f"{key} MP/G")
        if games < 15 or mpg < Decimal("10"):
            raise PreparationError(f"{key}: row fails the 15 games / 10 MPG qualification.")
        ts = decimal_value(rows["per_100"]["TS%"], location=f"{key} TS%")
        if not Decimal("0") <= ts <= Decimal("1"):
            raise PreparationError(f"{key}: TS% is not a fraction.")
        player_id, season = key
        featured = FEATURED_ROOKIES.get(player_id)
        total_minutes = ""
        total_minutes_source = ""
        if featured and season == "2025-26":
            total_minutes = str(featured["minutes"])
            total_minutes_source = f"assets/data/raw/NOP/{'JeremiahFears' if player_id == 'fearsje01' else 'DQueen'}_Adv.csv"
        output.append(
            {
                "player_id": player_id,
                "player_name": featured["name"] if featured and season == "2025-26" else rows["per_game"]["Player"],
                "season": season,
                "team": rows["per_game"]["Team"],
                "age": rows["per_game"]["Age"],
                "position": rows["per_game"]["Pos"],
                "games": str(games),
                "minutes_per_game": decimal_text(mpg),
                "total_minutes": total_minutes,
                "points_per_100": rows["per_100"]["PTS"],
                "assists_per_100": rows["per_100"]["AST"],
                "turnovers_per_100": rows["per_100"]["TOV"],
                "true_shooting_pct": rows["per_100"]["TS%"],
                "featured": "true" if featured and season == "2025-26" else "false",
                "advanced_source_row": rows["advanced"]["_source_row"],
                "per_100_source_row": rows["per_100"]["_source_row"],
                "per_game_source_row": rows["per_game"]["_source_row"],
                "total_minutes_source": total_minutes_source,
            }
        )

    by_id = {(row["player_id"], row["season"]): row for row in output}
    anchors = {
        ("fearsje01", "2025-26"): ("82", "26.5", "6.3", "4.0", ".525", "2112"),
        ("queende01", "2025-26"): ("81", "22.4", "7.0", "4.5", ".546", "2023"),
    }
    for key, expected in anchors.items():
        row = by_id[key]
        actual = (
            row["games"], row["points_per_100"], row["assists_per_100"],
            row["turnovers_per_100"], row["true_shooting_pct"], row["total_minutes"],
        )
        if actual != expected:
            raise PreparationError(f"{key}: anchor mismatch {actual} != {expected}.")
    return output


def source_by_season(path: Path, *, first_header: str = "Season") -> dict[str, dict[str, str]]:
    rows, _ = read_table(path, first_header)
    selected = [row for row in rows if row.get("Season") in ZION_SEASONS]
    indexed = index_unique(selected, ("Season",), source=path.name)
    return {season: row for (season,), row in indexed.items()}


def prepare_zion(raw_dir: Path) -> list[dict[str, str]]:
    nop_dir = raw_dir / "NOP"
    tables = {
        "advanced": source_by_season(nop_dir / "Zion_Adv.csv"),
        "per_100": source_by_season(nop_dir / "Zion_P100P.csv"),
        "per_game": source_by_season(nop_dir / "Zion_PerGame.csv"),
        "play_by_play": source_by_season(nop_dir / "Zion_PlayByPlay.csv"),
        "shooting": source_by_season(nop_dir / "Zion_Shooting.csv"),
    }
    played = set(tables["advanced"])
    expected_played = set(ZION_SEASONS) - {"2021-22"}
    if played != expected_played:
        raise PreparationError(f"Zion played seasons {sorted(played)} do not match expected.")
    for name, table in tables.items():
        if set(table) != expected_played:
            raise PreparationError(f"Zion {name} season coverage differs: {sorted(table)}.")

    onoff_rows, _ = read_table(nop_dir / "Zion_Williamson_OnOff_2026-27.csv", "player")
    onoff = {row["split"]: row for row in onoff_rows}
    if not {"On Court", "Off Court"} <= set(onoff):
        raise PreparationError("Zion on/off source is missing On Court or Off Court rows.")
    if onoff["On Court"]["team_ortg"] != "119.2" or onoff["Off Court"]["team_ortg"] != "104.2":
        raise PreparationError("Zion on/off offensive-rating anchors changed.")

    output: list[dict[str, str]] = []
    for season in ZION_SEASONS:
        if season == "2021-22":
            output.append(
                {
                    "season": season,
                    "season_start": season[:4],
                    "sample_status": "did_not_play",
                    "games": "0",
                    "total_minutes": "0",
                    "minutes_per_game": "",
                    "usage_pct": "",
                    "assists_per_100": "",
                    "true_shooting_pct": "",
                    "assisted_two_pct": "",
                    "play_by_play_on_court_net_per_100": "",
                    "team_ortg_on": "",
                    "team_ortg_on_minutes": "",
                    "team_ortg_off": "",
                    "team_ortg_off_minutes": "",
                }
            )
            continue
        rows = {name: table[season] for name, table in tables.items()}
        for field in ("Age", "Team", "G", "GS"):
            values = {name: row[field] for name, row in rows.items()}
            if len(set(values.values())) != 1:
                raise PreparationError(f"Zion {season}: {field} conflicts: {values}.")
        if rows["advanced"]["MP"] != rows["per_100"]["MP"]:
            raise PreparationError(f"Zion {season}: Advanced and P100P total minutes differ.")
        ts = decimal_value(rows["advanced"]["TS%"], location=f"Zion {season} TS%")
        usage = decimal_value(rows["advanced"]["USG%"], location=f"Zion {season} USG%")
        assisted_two = decimal_value(rows["shooting"]["2P__3"], location=f"Zion {season} assisted 2P%")
        if not Decimal("0") <= ts <= Decimal("1") or not Decimal("0") <= assisted_two <= Decimal("1"):
            raise PreparationError(f"Zion {season}: fractional percentage out of range.")
        if not Decimal("0") <= usage <= Decimal("100"):
            raise PreparationError(f"Zion {season}: USG% is not in percentage points.")
        current = season == "2026-27"
        output.append(
            {
                "season": season,
                "season_start": season[:4],
                "sample_status": "current_12_team_games" if current else "completed",
                "games": rows["advanced"]["G"],
                "total_minutes": rows["advanced"]["MP"],
                "minutes_per_game": rows["per_game"]["MP"],
                "usage_pct": rows["advanced"]["USG%"],
                "assists_per_100": rows["per_100"]["AST"],
                "true_shooting_pct": rows["advanced"]["TS%"],
                "assisted_two_pct": rows["shooting"]["2P__3"],
                "play_by_play_on_court_net_per_100": rows["play_by_play"]["OnCourt"],
                "team_ortg_on": onoff["On Court"]["team_ortg"] if current else "",
                "team_ortg_on_minutes": onoff["On Court"]["minutes"] if current else "",
                "team_ortg_off": onoff["Off Court"]["team_ortg"] if current else "",
                "team_ortg_off_minutes": onoff["Off Court"]["minutes"] if current else "",
            }
        )
    by_season = {row["season"]: row for row in output}
    anchors = {
        "2024-25": ("30", "34.7", "9.0", ".600"),
        "2025-26": ("62", "25.7", "5.2", ".644"),
        "2026-27": ("11", "22.8", "3.8", ".691"),
    }
    for season, expected in anchors.items():
        row = by_season[season]
        actual = (row["games"], row["usage_pct"], row["assists_per_100"], row["true_shooting_pct"])
        if actual != expected:
            raise PreparationError(f"Zion {season}: anchor mismatch {actual} != {expected}.")
    return output


def read_four_factors(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    if len(rows) < 4:
        raise PreparationError(f"{path.name}: incomplete four-factors table.")
    header = unique_headers(rows[1])
    team = dict(zip(header, (cell.strip() for cell in rows[2]), strict=True))
    ranks = dict(zip(header, (cell.strip() for cell in rows[3]), strict=True))
    if rows[2][0].strip() != "Team" or rows[3][0].strip() != "Lg Rank":
        raise PreparationError(f"{path.name}: unexpected Team/Lg Rank row layout.")
    return team, ranks


def read_basic(path: Path) -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    header = unique_headers(rows[0])
    mapped = [dict(zip(header, (cell.strip() for cell in row), strict=True)) for row in rows[1:]]
    labels = [row[0].strip() for row in rows[1:]]
    try:
        team_index = labels.index("Team")
        team_game_index = labels.index("Team/G")
        opponent_game_index = labels.index("Opponent/G")
    except ValueError as error:
        raise PreparationError(f"{path.name}: missing expected basic-stat rows.") from error
    return (
        mapped[team_index], mapped[team_game_index + 1],
        mapped[opponent_game_index], mapped[opponent_game_index + 1],
    )


def prepare_team(raw_dir: Path) -> list[dict[str, str]]:
    configs = (
        ("2025-26", "completed", "NOP_Team4Factors_2526.csv", "NOP_TeamBasic2526.csv"),
        ("2026-27", "current_12_games", "NOP_Team4Factors_2627.csv", "NOP_TeamBasic_2627.csv"),
    )
    output: list[dict[str, str]] = []
    for season, status, four_name, basic_name in configs:
        team, ranks = read_four_factors(raw_dir / "NOP" / four_name)
        basic_team, _, opponent_game, opponent_ranks = read_basic(raw_dir / "NOP" / basic_name)
        row = {
            "season": season,
            "sample_status": status,
            "games": basic_team["G"],
            "wins": team["W"],
            "losses": team["L"],
            "offensive_rating": team["ORtg"],
            "offensive_rating_rank": ranks["ORtg"],
            "defensive_rating": team["DRtg"],
            "defensive_rating_rank": ranks["DRtg"],
            "opponent_two_point_pct": opponent_game["2P%"],
            "opponent_two_point_defensive_rank": opponent_ranks["2P%"],
            "defensive_rebound_pct": team["DRB%"],
            "defensive_rebound_pct_rank": ranks["DRB%"],
            "three_point_attempt_rate": team["3PAr"],
            "three_point_attempt_rate_most_rank": ranks["3PAr"],
            "free_throw_attempt_rate": team["FTr"],
            "free_throw_attempt_rate_most_rank": ranks["FTr"],
            "opponent_rank_basis": "Source ranks lower opponent 2P% as better defensive quality (1 = lowest allowed).",
        }
        output.append(row)
    anchors = {
        "2025-26": ("114.4", "118.9", ".578", "71.4", ".355", ".284"),
        "2026-27": ("113.4", "120.5", ".606", "72.3", ".328", ".367"),
    }
    for row in output:
        actual = (
            row["offensive_rating"], row["defensive_rating"], row["opponent_two_point_pct"],
            row["defensive_rebound_pct"], row["three_point_attempt_rate"], row["free_throw_attempt_rate"],
        )
        if actual != anchors[row["season"]]:
            raise PreparationError(f"Team {row['season']}: anchor mismatch {actual}.")
    current = output[1]
    if (current["games"], current["wins"], current["losses"]) != ("12", "4", "8"):
        raise PreparationError("Current New Orleans team window is not 12 games and 4-8.")
    expected_ranks = ("17", "28", "18", "30", "1", "30")
    actual_ranks = (
        current["offensive_rating_rank"], current["defensive_rating_rank"],
        current["defensive_rebound_pct_rank"], current["three_point_attempt_rate_most_rank"],
        current["free_throw_attempt_rate_most_rank"], current["opponent_two_point_defensive_rank"],
    )
    if actual_ranks != expected_ranks:
        raise PreparationError(f"Current team rank anchors changed: {actual_ranks}.")
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
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument("--output-dir", type=Path, default=Path("assets/data/processed"))
    args = parser.parse_args()
    rookies = prepare_rookies(args.raw_dir)
    zion = prepare_zion(args.raw_dir)
    team = prepare_team(args.raw_dir)
    write_csv(args.output_dir / "pelicans-rookie-context-2023-2026.csv", rookies)
    write_csv(args.output_dir / "pelicans-zion-role-2019-2027.csv", zion)
    write_csv(args.output_dir / "pelicans-team-style-2025-2027.csv", team)
    print("Wrote 138 rookie rows, 8 Zion season-status rows and 2 team rows.")
    print("Validated rookie joins/counts, percentage units, source anchors and the 12-game 4-8 team window.")


if __name__ == "__main__":
    main()
