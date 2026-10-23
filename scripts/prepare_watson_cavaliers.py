#!/usr/bin/env python3
"""Validate Peyton Watson source tables and build the Cleveland chart dataset."""

from __future__ import annotations

import csv
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "data" / "raw"
OUTPUT = ROOT / "assets" / "data" / "processed" / "peyton-watson-denver-2022-2026.csv"
SEASONS = ("2022-23", "2023-24", "2024-25", "2025-26")
IDENTITY = ("Season", "Age", "Team", "Lg", "Pos", "G", "GS")
FILES = {
    "PerGame": RAW / "PeytonWatsonPerGame.csv",
    "P100": RAW / "PeytonWatsonP100P.csv",
    "Advanced": RAW / "PeytonWatsonAdv.csv",
    "OnOff": RAW / "PeytonWatsonOnOff.csv",
}
MERGED = RAW / "PeytonWatsonCareer_Merged.csv"


def read_regular_seasons(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = [
            row
            for row in csv.DictReader(handle)
            if re.fullmatch(r"\d{4}-\d{2}", (row.get("Season") or "").strip())
        ]
    if len(rows) != len(SEASONS):
        raise ValueError(f"{path.name}: expected four season rows, found {len(rows)}")
    return rows


def keyed(rows: list[dict[str, str]], name: str) -> dict[tuple[str, ...], dict[str, str]]:
    result: dict[tuple[str, ...], dict[str, str]] = {}
    for row in rows:
        key = tuple((row.get(field) or "").strip() for field in IDENTITY)
        if key in result:
            raise ValueError(f"{name}: duplicate player-season identity {key}")
        result[key] = row
    return result


def validate_merged(
    source_rows: dict[str, list[dict[str, str]]], merged_rows: list[dict[str, str]]
) -> None:
    merged_by_key = keyed(merged_rows, MERGED.name)
    for prefix, rows in source_rows.items():
        for key, source in keyed(rows, FILES[prefix].name).items():
            merged = merged_by_key.get(key)
            if merged is None:
                raise ValueError(f"{MERGED.name}: missing identity {key}")
            for field, value in source.items():
                merged_field = field if field in IDENTITY else f"{prefix}_{field}"
                if merged.get(merged_field, "") != value:
                    raise ValueError(
                        f"{MERGED.name}: {key[0]} {merged_field} does not match "
                        f"{FILES[prefix].name}"
                    )


def main() -> None:
    source_rows = {name: read_regular_seasons(path) for name, path in FILES.items()}
    merged_rows = read_regular_seasons(MERGED)
    validate_merged(source_rows, merged_rows)

    by_source = {name: keyed(rows, FILES[name].name) for name, rows in source_rows.items()}
    output_rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for season in SEASONS:
        matches = [key for key in by_source["PerGame"] if key[0] == season]
        if len(matches) != 1:
            raise ValueError(f"{season}: expected one Peyton Watson identity, found {len(matches)}")
        key = matches[0]
        if any(key not in rows for rows in by_source.values()):
            raise ValueError(f"{season}: source tables do not share the same player/team identity")
        if season in seen:
            raise ValueError(f"Duplicate season after join: {season}")
        seen.add(season)

        per_game = by_source["PerGame"][key]
        per_100 = by_source["P100"][key]
        advanced = by_source["Advanced"][key]
        on_off = by_source["OnOff"][key]
        total_minutes = advanced["MP"]
        if total_minutes != per_100["MP"] or total_minutes != on_off["MP"]:
            raise ValueError(f"{season}: total-minute fields disagree")
        if per_game["MP"] == total_minutes:
            raise ValueError(f"{season}: MPG was confused with total minutes")

        output_rows.append(
            {
                "player_id": "peyton-watson",
                "player_name": "Peyton Watson",
                "season": season,
                "season_type": "regular_season",
                "team": per_game["Team"],
                "league": per_game["Lg"],
                "position": per_game["Pos"],
                "age": per_game["Age"],
                "games": per_game["G"],
                "starts": per_game["GS"],
                "minutes_per_game": per_game["MP"],
                "total_minutes": total_minutes,
                "points_per_100": per_100["PTS"],
                "usage_pct": advanced["USG%"],
                "ts_pct": advanced["TS%"],
                "on_court_net_rating": on_off["OnCourt"],
                "on_off_net_rating": on_off["On-Off"],
                "per_game_source_row": str(source_rows["PerGame"].index(per_game) + 2),
                "per_100_source_row": str(source_rows["P100"].index(per_100) + 2),
                "advanced_source_row": str(source_rows["Advanced"].index(advanced) + 2),
                "on_off_source_row": str(source_rows["OnOff"].index(on_off) + 2),
            }
        )

    if tuple(row["season"] for row in output_rows) != SEASONS:
        raise ValueError("Output season coverage is incomplete or out of order")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(output_rows[0]))
        writer.writeheader()
        writer.writerows(output_rows)

    print(f"Validated five source files and wrote {len(output_rows)} rows to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
