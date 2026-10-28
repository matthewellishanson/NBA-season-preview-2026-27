#!/usr/bin/env python3
"""Validate Brandon Miller's source exports and build the Hornets chart dataset."""

from __future__ import annotations

import csv
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "data" / "raw"
OUTPUT = ROOT / "assets" / "data" / "processed" / "brandon-miller-hornets-2023-2026.csv"
SEASONS = ("2023-24", "2024-25", "2025-26")
TEAM = "CHO"
FILES = {
    "per_game": RAW / "Miller_PerGame.csv",
    "per_100": RAW / "Miller_P100P.csv",
    "advanced": RAW / "Miller_Adv.csv",
    "adjusted": RAW / "Miller_AdjShooting.csv",
}
EXPECTED = {
    "2023-24": (74, "32.2", "2383", "26.5", "23.9", ".552", "95"),
    "2024-25": (27, "34.2", "924", "30.2", "27.7", ".540", "94"),
    "2025-26": (65, "30.3", "1968", "33.0", "28.1", ".574", "99"),
}


def read_table(path: Path, grouped_header: bool = False) -> tuple[list[dict[str, str]], int]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        raw = list(csv.reader(source))
    header_index = 1 if grouped_header else 0
    if grouped_header:
        group_row = raw[0]
        required_groups = {"Shooting %", "League-Adjusted", "Added"}
        if not required_groups.issubset(set(group_row)):
            raise ValueError(f"{path.name}: grouped header structure changed")
    if raw[header_index][:3] != ["Season", "Age", "Team"]:
        raise ValueError(f"{path.name}: column header structure changed")
    rows: list[dict[str, str]] = []
    header = raw[header_index]
    for row in raw[header_index + 1 :]:
        if not row or not re.fullmatch(r"\d{4}-\d{2}", row[0].strip()):
            continue
        # The 2025-26 advanced exports omit the final blank Awards cell.
        if len(row) == len(header) - 1 and header[-1] == "Awards":
            row = [*row, ""]
        if len(row) != len(header):
            raise ValueError(f"{path.name}: data row width does not match its header")
        rows.append(dict(zip(header, row, strict=True)))
    return rows, header_index + 2


def keyed(rows: list[dict[str, str]], name: str) -> dict[tuple[str, str], dict[str, str]]:
    result: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows:
        key = (row["Season"].strip(), row["Team"].strip())
        if key in result:
            raise ValueError(f"{name}: duplicate season/team key {key}")
        result[key] = row
    return result


def main() -> None:
    loaded: dict[str, list[dict[str, str]]] = {}
    first_data_rows: dict[str, int] = {}
    for name, path in FILES.items():
        rows, first_data_row = read_table(path, grouped_header=name == "adjusted")
        loaded[name] = rows
        first_data_rows[name] = first_data_row

    tables = {name: keyed(rows, FILES[name].name) for name, rows in loaded.items()}
    output_rows: list[dict[str, str]] = []
    for season in SEASONS:
        key = (season, TEAM)
        if any(key not in table for table in tables.values()):
            raise ValueError(f"{season}: source tables do not share one {TEAM} row")
        per_game = tables["per_game"][key]
        per_100 = tables["per_100"][key]
        advanced = tables["advanced"][key]
        adjusted = tables["adjusted"][key]

        identity_fields = ("Age", "Lg", "Pos", "G", "GS")
        if any(len({row[field] for row in (per_game, per_100, advanced, adjusted)}) != 1 for field in identity_fields):
            raise ValueError(f"{season}: joined identity fields disagree")
        if len({per_100["MP"], advanced["MP"], adjusted["MP"]}) != 1:
            raise ValueError(f"{season}: total-minute fields disagree")
        if per_game["MP"] == advanced["MP"]:
            raise ValueError(f"{season}: per-game and total-minute MP were confused")

        actual = (
            int(per_game["G"]), per_game["MP"], advanced["MP"], per_100["PTS"],
            advanced["USG%"], advanced["TS%"], adjusted["TS+"],
        )
        if actual != EXPECTED[season]:
            raise ValueError(f"{season}: values differ from the verified export mapping: {actual}")
        if not 0 < float(advanced["TS%"]) < 1 or float(advanced["USG%"]) < 1:
            raise ValueError(f"{season}: TS% or USG% units are invalid")

        output_rows.append({
            "player_id": "brandon-miller",
            "player_name": "Brandon Miller",
            "season": season,
            "team": TEAM,
            "games": per_game["G"],
            "minutes_per_game": per_game["MP"],
            "total_minutes": advanced["MP"],
            "points_per_100": per_100["PTS"],
            "usage_pct": advanced["USG%"],
            "ts_pct": advanced["TS%"],
            "ts_plus": adjusted["TS+"],
            "per_game_source_row": str(first_data_rows["per_game"] + loaded["per_game"].index(per_game)),
            "per_100_source_row": str(first_data_rows["per_100"] + loaded["per_100"].index(per_100)),
            "advanced_source_row": str(first_data_rows["advanced"] + loaded["advanced"].index(advanced)),
            "adjusted_source_row": str(first_data_rows["adjusted"] + loaded["adjusted"].index(adjusted)),
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(output_rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(output_rows)
    print(f"Validated four source files and wrote {len(output_rows)} rows to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
