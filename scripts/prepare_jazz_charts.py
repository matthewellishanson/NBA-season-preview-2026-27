#!/usr/bin/env python3
"""Validate the supplied Utah player tables and build chart-ready datasets."""

from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "data" / "raw"
PROCESSED = ROOT / "assets" / "data" / "processed"

GEORGE_SEASONS = ("2023-24", "2024-25", "2025-26")
REBOUND_SEASONS = ("2022-23", "2023-24", "2024-25", "2025-26")

SOURCES = {
    "george_per_game": RAW / "KeyonteGeorgePerGame.csv",
    "george_per_100": RAW / "KeyonteGeorgeP100P.csv",
    "george_advanced": RAW / "KeyonteGeorgeAdv.csv",
    "jackson_advanced": RAW / "JJJ_Adv.csv",
    "jackson_per_100": RAW / "JJJ_P100P.csv",
    "jackson_per_game_bad": RAW / "JJJ_PerGame.csv",
    "markkanen_advanced": RAW / "MarkkanenAdv.csv",
    "markkanen_per_100": RAW / "MarkkanenP100P.csv",
    "markkanen_per_game": RAW / "MarkkanenPerGame.csv",
}

SCHEMAS = {
    "per_game": {"Season", "Age", "Team", "Lg", "Pos", "G", "GS", "MP", "PTS", "AST"},
    "per_100": {"Season", "Age", "Team", "Lg", "Pos", "G", "GS", "MP", "ORB", "DRB", "TRB", "PTS"},
    "advanced": {"Season", "Age", "Team", "Lg", "Pos", "G", "GS", "MP", "TS%", "ORB%", "DRB%", "TRB%", "USG%"},
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_table(path: Path, table_type: str) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or ())
        missing = SCHEMAS[table_type] - fields
        if missing:
            raise ValueError(f"{path.name}: missing {table_type} columns {sorted(missing)}")
        rows = []
        for line_number, row in enumerate(reader, start=2):
            season = (row.get("Season") or "").strip()
            if not re.fullmatch(r"\d{4}-\d{2}", season):
                continue
            clean = {key: (value or "").strip() for key, value in row.items()}
            clean["_source_row"] = str(line_number)
            rows.append(clean)
    return rows


def choose_seasons(
    rows: list[dict[str, str]],
    path: Path,
    seasons: tuple[str, ...],
    allowed_teams: set[str],
) -> dict[str, dict[str, str]]:
    chosen: dict[str, dict[str, str]] = {}
    for season in seasons:
        candidates = [row for row in rows if row["Season"] == season]
        aggregates = [row for row in candidates if row["Team"] in {"TOT", "2TM", "3TM"}]
        if aggregates:
            candidates = aggregates
        if len(candidates) != 1:
            raise ValueError(f"{path.name}: expected one preferred row for {season}, found {len(candidates)}")
        row = candidates[0]
        if row["Lg"] != "NBA" or row["Team"] not in allowed_teams:
            raise ValueError(f"{path.name}: unexpected player context in {season}: {row['Lg']} {row['Team']}")
        chosen[season] = row
    return chosen


def validate_join_identity(season: str, named_rows: dict[str, dict[str, str]], allow_team_mix: bool = False) -> None:
    for field in ("Season", "Age", "Lg", "Pos", "G", "GS"):
        values = {row[field] for row in named_rows.values()}
        if len(values) != 1:
            raise ValueError(f"{season}: {field} disagrees across {sorted(named_rows)}: {sorted(values)}")
    if not allow_team_mix and len({row["Team"] for row in named_rows.values()}) != 1:
        raise ValueError(f"{season}: team identifier disagrees across joined tables")


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def prepare_george() -> None:
    per_game = choose_seasons(read_table(SOURCES["george_per_game"], "per_game"), SOURCES["george_per_game"], GEORGE_SEASONS, {"UTA"})
    per_100 = choose_seasons(read_table(SOURCES["george_per_100"], "per_100"), SOURCES["george_per_100"], GEORGE_SEASONS, {"UTA"})
    advanced = choose_seasons(read_table(SOURCES["george_advanced"], "advanced"), SOURCES["george_advanced"], GEORGE_SEASONS, {"UTA"})
    output = []
    for season in GEORGE_SEASONS:
        rows = {"per_game": per_game[season], "per_100": per_100[season], "advanced": advanced[season]}
        validate_join_identity(season, rows)
        if per_100[season]["MP"] != advanced[season]["MP"]:
            raise ValueError(f"George {season}: total minutes disagree")
        if per_game[season]["MP"] == advanced[season]["MP"]:
            raise ValueError(f"George {season}: per-game MP was confused with total minutes")
        output.append({
            "player_id": "keyonte-george", "player_name": "Keyonte George", "season": season,
            "season_type": "regular_season", "team": "UTA", "games": per_game[season]["G"],
            "minutes_per_game": per_game[season]["MP"], "total_minutes": advanced[season]["MP"],
            "points_per_game": per_game[season]["PTS"], "assists_per_game": per_game[season]["AST"],
            "points_per_100": per_100[season]["PTS"], "assists_per_100": per_100[season]["AST"],
            "ts_pct": advanced[season]["TS%"], "usage_pct": advanced[season]["USG%"],
            "per_game_source_row": per_game[season]["_source_row"],
            "per_100_source_row": per_100[season]["_source_row"],
            "advanced_source_row": advanced[season]["_source_row"],
        })
    write_csv(PROCESSED / "keyonte-george-scoring-2023-2026.csv", output)


def prepare_rebounding() -> None:
    bad = SOURCES["jackson_per_game_bad"]
    markkanen_advanced = SOURCES["markkanen_advanced"]
    if digest(bad) != digest(markkanen_advanced):
        raise ValueError("JJJ_PerGame.csv no longer matches MarkkanenAdv.csv; inspect it before changing the exclusion rule")

    player_sources = {
        "lauri-markkanen": {
            "name": "Lauri Markkanen", "teams": {"UTA"},
            "advanced_path": markkanen_advanced, "per_100_path": SOURCES["markkanen_per_100"],
            "per_game_path": SOURCES["markkanen_per_game"],
        },
        "jaren-jackson-jr": {
            "name": "Jaren Jackson Jr.", "teams": {"MEM", "UTA", "2TM", "TOT"},
            "advanced_path": SOURCES["jackson_advanced"], "per_100_path": SOURCES["jackson_per_100"],
            "per_game_path": None,
        },
    }
    output = []
    for player_id, config in player_sources.items():
        advanced = choose_seasons(read_table(config["advanced_path"], "advanced"), config["advanced_path"], REBOUND_SEASONS, config["teams"])
        per_100 = choose_seasons(read_table(config["per_100_path"], "per_100"), config["per_100_path"], REBOUND_SEASONS, config["teams"])
        per_game = None
        if config["per_game_path"]:
            per_game = choose_seasons(read_table(config["per_game_path"], "per_game"), config["per_game_path"], REBOUND_SEASONS, config["teams"])
        for season in REBOUND_SEASONS:
            joined = {"advanced": advanced[season], "per_100": per_100[season]}
            if per_game:
                joined["per_game"] = per_game[season]
            validate_join_identity(season, joined)
            if advanced[season]["MP"] != per_100[season]["MP"]:
                raise ValueError(f"{config['name']} {season}: total minutes disagree")
            output.append({
                "player_id": player_id, "player_name": config["name"], "season": season,
                "season_type": "regular_season", "team": advanced[season]["Team"],
                "team_label": "Memphis/Utah combined" if player_id == "jaren-jackson-jr" and season == "2025-26" else advanced[season]["Team"],
                "games": advanced[season]["G"], "total_minutes": advanced[season]["MP"],
                "minutes_per_game": per_game[season]["MP"] if per_game else "",
                "orb_pct": advanced[season]["ORB%"], "drb_pct": advanced[season]["DRB%"],
                "trb_pct": advanced[season]["TRB%"], "orb_per_100": per_100[season]["ORB"],
                "drb_per_100": per_100[season]["DRB"], "trb_per_100": per_100[season]["TRB"],
                "advanced_source_row": advanced[season]["_source_row"],
                "per_100_source_row": per_100[season]["_source_row"],
                "per_game_source_row": per_game[season]["_source_row"] if per_game else "excluded_mislabeled_source",
            })
    write_csv(PROCESSED / "markkanen-jackson-rebounding-2022-2026.csv", output)


def main() -> None:
    prepare_george()
    prepare_rebounding()
    print("Validated nine supplied files; excluded mislabeled JJJ_PerGame.csv; wrote 3 George rows and 8 rebounding rows.")


if __name__ == "__main__":
    main()
