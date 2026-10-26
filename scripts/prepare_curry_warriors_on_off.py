#!/usr/bin/env python3
"""Validate Curry/Warriors on-off inputs and build the chart-ready dataset."""

from __future__ import annotations

import csv
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "data" / "raw"
PROCESSED = ROOT / "assets" / "data" / "processed"
ON_OFF_PATH = RAW / "Curry_Warriors_OnOff_2016to2026.csv"
LEAGUE_PATH = RAW / "LeagueAverages_P100P.csv"
OUTPUT_PATH = PROCESSED / "curry-warriors-on-off-2016-2026.csv"

SEASONS = (
    "2015-16", "2016-17", "2017-18", "2018-19", "2019-20", "2020-21",
    "2021-22", "2022-23", "2023-24", "2024-25", "2025-26",
)
RATING_SEASONS = tuple(season for season in SEASONS if season != "2019-20")
ON_OFF_FIELDS = {
    "season", "on_minutes", "off_minutes", "on_ortg", "off_ortg",
    "on_drtg", "off_drtg", "league_ortg",
}
LEAGUE_FIELDS = {"Season", "Lg", "G", "ORtg"}
OUTPUT_FIELDS = (
    "season", "season_end_year", "league", "observation_status", "on_minutes",
    "off_minutes", "on_ortg", "off_ortg", "on_drtg", "off_drtg",
    "league_ortg", "on_relative_ortg", "off_relative_ortg",
    "offensive_on_off_gap", "source_on_off_row", "source_league_row",
    "source_url", "source_provenance", "exclusion_note",
)


def quantize(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def read_on_off() -> dict[str, dict[str, str]]:
    with ON_OFF_PATH.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = ON_OFF_FIELDS - set(reader.fieldnames or ())
        if missing:
            raise ValueError(f"{ON_OFF_PATH.name}: missing columns {sorted(missing)}")
        rows: dict[str, dict[str, str]] = {}
        for line_number, row in enumerate(reader, start=2):
            season = (row.get("season") or "").strip()
            if not season:
                continue
            if season in rows:
                raise ValueError(f"{ON_OFF_PATH.name}: duplicate season {season}")
            clean = {key: (value or "").strip() for key, value in row.items()}
            clean["_source_row"] = str(line_number)
            rows[season] = clean
    if set(rows) != set(RATING_SEASONS):
        raise ValueError(
            f"{ON_OFF_PATH.name}: expected {list(RATING_SEASONS)}, found {sorted(rows)}"
        )
    return rows


def read_league_averages() -> dict[str, dict[str, str]]:
    with LEAGUE_PATH.open(encoding="utf-8-sig", newline="") as handle:
        grouped_header = next(handle, None)
        if grouped_header is None or "Per 100 Team Possessions" not in grouped_header:
            raise ValueError(f"{LEAGUE_PATH.name}: expected grouped header row first")
        reader = csv.DictReader(handle)
        missing = LEAGUE_FIELDS - set(reader.fieldnames or ())
        if missing:
            raise ValueError(f"{LEAGUE_PATH.name}: missing columns {sorted(missing)}")
        rows: dict[str, dict[str, str]] = {}
        for line_number, row in enumerate(reader, start=3):
            season = (row.get("Season") or "").strip()
            league = (row.get("Lg") or "").strip()
            if season == "2026-27":
                # The supplied season is in progress (36 team games) and is intentionally excluded.
                if row.get("G") == "1230":
                    raise ValueError("2026-27 unexpectedly appears complete; review the exclusion rule")
                continue
            if season not in SEASONS or league != "NBA":
                continue
            if season in rows:
                raise ValueError(f"{LEAGUE_PATH.name}: duplicate NBA row for {season}")
            clean = {key: (value or "").strip() for key, value in row.items()}
            clean["_source_row"] = str(line_number)
            rows[season] = clean
    if set(rows) != set(SEASONS):
        raise ValueError(
            f"{LEAGUE_PATH.name}: expected one NBA match for every chronological season; found {sorted(rows)}"
        )
    return rows


def build_rows() -> list[dict[str, str]]:
    on_off = read_on_off()
    league = read_league_averages()
    output: list[dict[str, str]] = []
    for season in SEASONS:
        end_year = 2000 + int(season[-2:])
        source_url = f"https://www.basketball-reference.com/teams/GSW/{end_year}/on-off/"
        if season == "2019-20":
            baseline = league[season]
            output.append({
                **{field: "" for field in OUTPUT_FIELDS},
                "season": season,
                "season_end_year": str(end_year),
                "league": "NBA",
                "observation_status": "ratings_omitted_small_sample",
                "on_minutes": "139",
                "league_ortg": quantize(Decimal(baseline["ORtg"])),
                "source_league_row": baseline["_source_row"],
                "source_url": source_url,
                "source_provenance": "author small-sample ratings exclusion; minutes supplied by author; league baseline from LeagueAverages_P100P.csv",
                "exclusion_note": "Ratings deliberately omitted: Curry played only 139 minutes",
            })
            continue

        source = on_off[season]
        baseline = league[season]
        if baseline["Lg"] != "NBA":
            raise ValueError(f"{season}: league baseline is not NBA")
        if Decimal(source["league_ortg"]) != Decimal(baseline["ORtg"]):
            raise ValueError(
                f"{season}: transcribed league ORtg {source['league_ortg']} does not match "
                f"{LEAGUE_PATH.name} {baseline['ORtg']}"
            )

        on_ortg = Decimal(source["on_ortg"])
        off_ortg = Decimal(source["off_ortg"])
        league_ortg = Decimal(baseline["ORtg"])
        output.append({
            "season": season,
            "season_end_year": str(end_year),
            "league": "NBA",
            "observation_status": "observed",
            "on_minutes": source["on_minutes"],
            "off_minutes": source["off_minutes"],
            "on_ortg": quantize(on_ortg),
            "off_ortg": quantize(off_ortg),
            "on_drtg": quantize(Decimal(source["on_drtg"])),
            "off_drtg": quantize(Decimal(source["off_drtg"])),
            "league_ortg": quantize(league_ortg),
            "on_relative_ortg": quantize(on_ortg - league_ortg),
            "off_relative_ortg": quantize(off_ortg - league_ortg),
            "offensive_on_off_gap": quantize(on_ortg - off_ortg),
            "source_on_off_row": source["_source_row"],
            "source_league_row": baseline["_source_row"],
            "source_url": source_url,
            "source_provenance": "Basketball Reference Curry on/off tables, manually transcribed by the author",
            "exclusion_note": "",
        })
    return output


def main() -> None:
    rows = build_rows()
    observed = [row for row in rows if row["observation_status"] == "observed"]
    excluded = [row for row in rows if row["observation_status"] == "ratings_omitted_small_sample"]
    if len(rows) != 11 or len(observed) != 10 or len(excluded) != 1 or excluded[0]["on_minutes"] != "139":
        raise ValueError("Expected ten rating seasons and one 139-minute small-sample ratings exclusion")
    if any(row["season"] == "2026-27" for row in rows):
        raise ValueError("Incomplete 2026-27 data reached output")
    PROCESSED.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(
        "Validated 10 rating seasons and 11 one-to-one NBA league baselines; "
        "wrote 11 chronological rows with 139 minutes and an explicit 2019-20 ratings gap."
    )


if __name__ == "__main__":
    main()
