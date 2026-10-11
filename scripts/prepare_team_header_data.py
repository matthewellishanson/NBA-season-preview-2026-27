#!/usr/bin/env python3
"""Build the 2025-26 team-preview header asset from local source tables."""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RATINGS_PATH = ROOT / "assets/data/processed/team-ratings-2016-2026.csv"
STANDINGS_PATH = ROOT / "assets/data/raw/nba-standings-2025-26.csv"
PREVIEW_PATH = ROOT / "2026-27-previews-prototype.html"
OUTPUT_PATH = ROOT / "assets/data/processed/team-header-2025-26.js"
SEASON = "2025-26"

# Stable preview code -> (preview slug, preview/ratings name, official standings name).
TEAM_MAP = {
    "ATL": ("hawks", "Atlanta Hawks", "Atlanta Hawks"),
    "BKN": ("nets", "Brooklyn Nets", "Brooklyn Nets"),
    "BOS": ("celtics", "Boston Celtics", "Boston Celtics"),
    "CHA": ("hornets", "Charlotte Hornets", "Charlotte Hornets"),
    "CHI": ("bulls", "Chicago Bulls", "Chicago Bulls"),
    "CLE": ("cavaliers", "Cleveland Cavaliers", "Cleveland Cavaliers"),
    "DAL": ("mavericks", "Dallas Mavericks", "Dallas Mavericks"),
    "DEN": ("nuggets", "Denver Nuggets", "Denver Nuggets"),
    "DET": ("pistons", "Detroit Pistons", "Detroit Pistons"),
    "GSW": ("warriors", "Golden State Warriors", "Golden State Warriors"),
    "HOU": ("rockets", "Houston Rockets", "Houston Rockets"),
    "IND": ("pacers", "Indiana Pacers", "Indiana Pacers"),
    "LAC": ("clippers", "Los Angeles Clippers", "LA Clippers"),
    "LAL": ("lakers", "Los Angeles Lakers", "Los Angeles Lakers"),
    "MEM": ("grizzlies", "Memphis Grizzlies", "Memphis Grizzlies"),
    "MIA": ("heat", "Miami Heat", "Miami Heat"),
    "MIL": ("bucks", "Milwaukee Bucks", "Milwaukee Bucks"),
    "MIN": ("timberwolves", "Minnesota Timberwolves", "Minnesota Timberwolves"),
    "NOP": ("pelicans", "New Orleans Pelicans", "New Orleans Pelicans"),
    "NYK": ("knicks", "New York Knicks", "New York Knicks"),
    "OKC": ("thunder", "Oklahoma City Thunder", "Oklahoma City Thunder"),
    "ORL": ("magic", "Orlando Magic", "Orlando Magic"),
    "PHI": ("sixers", "Philadelphia 76ers", "Philadelphia 76ers"),
    "PHX": ("suns", "Phoenix Suns", "Phoenix Suns"),
    "POR": ("trail-blazers", "Portland Trail Blazers", "Portland Trail Blazers"),
    "SAC": ("kings", "Sacramento Kings", "Sacramento Kings"),
    "SAS": ("spurs", "San Antonio Spurs", "San Antonio Spurs"),
    "TOR": ("raptors", "Toronto Raptors", "Toronto Raptors"),
    "UTA": ("jazz", "Utah Jazz", "Utah Jazz"),
    "WAS": ("wizards", "Washington Wizards", "Washington Wizards"),
}

REQUIRED_RATINGS = (
    "wins",
    "losses",
    "ortg",
    "drtg",
    "netrtg",
    "ortg_rank",
    "drtg_rank",
    "netrtg_rank",
)


def fail(message: str) -> None:
    raise ValueError(message)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def parse_int(value: str, label: str) -> int:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise ValueError(f"{label} must be numeric; found {value!r}") from error
    if parsed != parsed.to_integral_value():
        fail(f"{label} must be an integer; found {value!r}")
    return int(parsed)


def parse_number(value: str, label: str) -> float:
    try:
        return float(Decimal(value))
    except InvalidOperation as error:
        raise ValueError(f"{label} must be numeric; found {value!r}") from error


def validate_preview_mapping() -> None:
    source = PREVIEW_PATH.read_text(encoding="utf-8")
    pattern = re.compile(
        r'name:\s*"(?P<name>[^"]+)"\s*,\s*'
        r'code:\s*"(?P<code>[^"]+)".*?'
        r'slug:\s*"(?P<slug>[^"]+)"',
        re.DOTALL,
    )
    preview_rows = [match.groupdict() for match in pattern.finditer(source)]
    if len(preview_rows) != 30:
        fail(f"Expected 30 preview teams; found {len(preview_rows)}")
    if len({row["code"] for row in preview_rows}) != 30:
        fail("Preview team codes are not unique")
    if set(row["code"] for row in preview_rows) != set(TEAM_MAP):
        fail("Preview team codes do not exactly match TEAM_MAP")
    for row in preview_rows:
        slug, preview_name, _ = TEAM_MAP[row["code"]]
        if (row["slug"], row["name"]) != (slug, preview_name):
            fail(f"Preview mapping mismatch for {row['code']}")


def main() -> None:
    validate_preview_mapping()

    rating_rows = [row for row in read_csv(RATINGS_PATH) if row["season"] == SEASON]
    if len(rating_rows) != 30:
        fail(f"Expected 30 ratings rows for {SEASON}; found {len(rating_rows)}")
    ratings_by_name = {row["team"]: row for row in rating_rows}
    if len(ratings_by_name) != 30:
        fail(f"Ratings rows for {SEASON} do not have 30 unique team names")

    standings_rows = read_csv(STANDINGS_PATH)
    if len(standings_rows) != 30:
        fail(f"Expected 30 standings rows; found {len(standings_rows)}")
    standings_by_code = {row["team_code"]: row for row in standings_rows}
    if len(standings_by_code) != 30 or set(standings_by_code) != set(TEAM_MAP):
        fail("Standings team codes do not exactly match the 30 preview teams")

    conference_counts = Counter(row["conference"] for row in standings_rows)
    if conference_counts != Counter({"East": 15, "West": 15}):
        fail(f"Expected 15 standings teams per conference; found {dict(conference_counts)}")
    for conference in ("East", "West"):
        positions = {
            parse_int(row["conference_position"], f"{row['team_code']} conference_position")
            for row in standings_rows
            if row["conference"] == conference
        }
        if positions != set(range(1, 16)):
            fail(f"{conference} positions must contain each number 1-15 exactly once")

    source_urls = {row["source_url"] for row in standings_rows}
    retrieval_dates = {row["retrieved_date"] for row in standings_rows}
    if len(source_urls) != 1 or len(retrieval_dates) != 1:
        fail("Standings rows must share one source URL and one retrieval date")

    teams = {}
    for code in sorted(TEAM_MAP):
        slug, ratings_name, standings_name = TEAM_MAP[code]
        rating = ratings_by_name.get(ratings_name)
        standing = standings_by_code[code]
        if rating is None:
            fail(f"No {SEASON} ratings row for {ratings_name}")
        if standing["team"] != standings_name:
            fail(f"Official standings name mismatch for {code}")
        for field in REQUIRED_RATINGS:
            if not rating.get(field, "").strip():
                fail(f"{ratings_name} is missing required ratings field {field}")

        wins = parse_int(rating["wins"], f"{code} wins")
        losses = parse_int(rating["losses"], f"{code} losses")
        if wins != parse_int(standing["wins"], f"{code} standings wins") or losses != parse_int(
            standing["losses"], f"{code} standings losses"
        ):
            fail(f"Ratings and official standings records disagree for {code}")

        ranks = {
            field: parse_int(rating[field], f"{code} {field}")
            for field in ("ortg_rank", "drtg_rank", "netrtg_rank")
        }
        if any(rank < 1 or rank > 30 for rank in ranks.values()):
            fail(f"Metric rank outside 1-30 for {code}")

        teams[code] = {
            "slug": slug,
            "wins": wins,
            "losses": losses,
            "conference": standing["conference"],
            "conference_position": parse_int(
                standing["conference_position"], f"{code} conference_position"
            ),
            "ortg": parse_number(rating["ortg"], f"{code} ortg"),
            "drtg": parse_number(rating["drtg"], f"{code} drtg"),
            "netrtg": parse_number(rating["netrtg"], f"{code} netrtg"),
            **ranks,
        }

    spurs = teams["SAS"]
    expected_spurs = (119.68, 111.41, 8.27, 4, 3, 2)
    actual_spurs = (
        spurs["ortg"],
        spurs["drtg"],
        spurs["netrtg"],
        spurs["ortg_rank"],
        spurs["drtg_rank"],
        spurs["netrtg_rank"],
    )
    if actual_spurs != expected_spurs:
        fail(f"San Antonio source values changed: expected {expected_spurs}, found {actual_spurs}")

    payload = {
        "season": SEASON,
        "ratings_source_url": rating_rows[0]["source_url"],
        "standings_source_url": next(iter(source_urls)),
        "standings_retrieved_date": next(iter(retrieval_dates)),
        "teams": teams,
    }
    compact_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    OUTPUT_PATH.write_text(
        "// Generated by scripts/prepare_team_header_data.py; do not edit by hand.\n"
        f"window.TEAM_HEADER_DATA_2025_26 = Object.freeze({compact_json});\n",
        encoding="utf-8",
    )
    print(f"Validated and wrote {len(teams)} team headers to {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
