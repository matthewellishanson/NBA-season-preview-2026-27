#!/usr/bin/env python3
"""Validate and prepare 2016-17 through 2025-26 NBA team ratings data."""

from __future__ import annotations

import csv
import html
import io
import re
import sys
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, localcontext
from fractions import Fraction
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "assets" / "data"
OUTPUT_DIR = DATA_DIR / "processed"

# Keep this map explicit: filenames are part of the provenance contract.
FILE_SEASONS = {
    "teamratings1617.csv": (2016, 2017),
    "teamratings1718.csv": (2017, 2018),
    "teamratings1819.csv": (2018, 2019),
    "teamratings1920.csv": (2019, 2020),
    "teamratings2021.csv": (2020, 2021),
    "teamratings2122.csv": (2021, 2022),
    "teamratings2223.csv": (2022, 2023),
    "teamratings2324.csv": (2023, 2024),
    "teamratings2425.csv": (2024, 2025),
    "teamratings2526.csv": (2025, 2026),
}

EXPECTED_HEADERS = [
    "Rk", "Team", "Conf", "Div", "W", "L", "W/L%", "MOV", "ORtg",
    "DRtg", "NRtg", "MOV/A", "ORtg/A", "DRtg/A", "NRtg/A",
]

# These are the only non-team labels that may be discarded. Anything else fails.
SUMMARY_TEAM_LABELS = {
    "League Average",
    "League Totals",
    "Average",
    "Total",
    "Totals",
}

EXPECTED_TEAMS = {
    "Atlanta Hawks",
    "Boston Celtics",
    "Brooklyn Nets",
    "Charlotte Hornets",
    "Chicago Bulls",
    "Cleveland Cavaliers",
    "Dallas Mavericks",
    "Denver Nuggets",
    "Detroit Pistons",
    "Golden State Warriors",
    "Houston Rockets",
    "Indiana Pacers",
    "Los Angeles Clippers",
    "Los Angeles Lakers",
    "Memphis Grizzlies",
    "Miami Heat",
    "Milwaukee Bucks",
    "Minnesota Timberwolves",
    "New Orleans Pelicans",
    "New York Knicks",
    "Oklahoma City Thunder",
    "Orlando Magic",
    "Philadelphia 76ers",
    "Phoenix Suns",
    "Portland Trail Blazers",
    "Sacramento Kings",
    "San Antonio Spurs",
    "Toronto Raptors",
    "Utah Jazz",
    "Washington Wizards",
}

OUTPUT_FIELDS = [
    "season", "season_start_year", "season_end_year", "source_file",
    "source_url", "source_rank", "team", "conference", "division", "wins",
    "losses", "games", "win_pct", "source_win_pct", "mov", "ortg", "drtg",
    "netrtg", "record_rank", "ortg_rank", "drtg_rank", "netrtg_rank",
    "mov_adj", "ortg_adj", "drtg_adj", "netrtg_adj", "ortg_adj_rank",
    "drtg_adj_rank", "netrtg_adj_rank",
]

ENTITY_RE = re.compile(r"&(?:[A-Za-z][A-Za-z0-9]+|#[0-9]+|#x[0-9A-Fa-f]+);")
RATING_FIELDS = {
    "MOV": "mov",
    "ORtg": "ortg",
    "DRtg": "drtg",
    "NRtg": "netrtg",
    "MOV/A": "mov_adj",
    "ORtg/A": "ortg_adj",
    "DRtg/A": "drtg_adj",
    "NRtg/A": "netrtg_adj",
}


class PrepError(RuntimeError):
    """A clear, expected input validation failure."""


@dataclass
class Report:
    normalization_changes: list[str]
    excluded_summaries: list[str]
    max_unadjusted_net_delta: Decimal = Decimal("0")
    max_adjusted_net_delta: Decimal = Decimal("0")


def season_label(start: int, end: int) -> str:
    return f"{start}-{str(end)[-2:]}"


def discover_inputs() -> list[tuple[Path, int, int]]:
    if not DATA_DIR.is_dir():
        raise PrepError(f"Data directory does not exist: {DATA_DIR}")

    if len(FILE_SEASONS) != 10 or len(set(FILE_SEASONS.values())) != 10:
        raise PrepError("The explicit filename map must contain 10 unique seasons.")

    present = {path.name: path for path in DATA_DIR.iterdir() if path.is_file()}
    missing = [name for name in FILE_SEASONS if name not in present]
    if missing:
        raise PrepError("Missing required input file(s): " + ", ".join(missing))

    # Reject case variants and alternate teamratings CSV names that could make a
    # target season ambiguous, while ignoring unrelated CSVs in assets/data.
    expected_lower = {name.lower(): name for name in FILE_SEASONS}
    candidates = [
        path for path in DATA_DIR.iterdir()
        if path.is_file() and path.suffix.lower() == ".csv"
        and path.name.lower().startswith("teamratings")
    ]
    unexpected = [path.name for path in candidates if path.name not in FILE_SEASONS]
    case_duplicates = [
        path.name for path in candidates
        if path.name.lower() in expected_lower and path.name != expected_lower[path.name.lower()]
    ]
    if case_duplicates:
        raise PrepError(
            "Duplicate/ambiguous input filename(s), differing only by case: "
            + ", ".join(sorted(case_duplicates))
        )
    if unexpected:
        raise PrepError(
            "Ambiguous team-ratings CSV file(s) outside the explicit 10-file map: "
            + ", ".join(sorted(unexpected))
        )

    return [
        (present[name], start, end)
        for name, (start, end) in sorted(FILE_SEASONS.items(), key=lambda item: item[1])
    ]


def normalize_text(value: str, *, location: str, report: Report) -> str:
    normalized = value
    changes: list[str] = []
    if "**" in normalized:
        normalized = normalized.replace("**", "")
        changes.append("removed Markdown **")
    if ENTITY_RE.search(normalized):
        normalized = html.unescape(normalized)
        changes.append("decoded HTML entity")
    if changes:
        report.normalization_changes.append(
            f"{location}: {', '.join(changes)} ({value!r} -> {normalized!r})"
        )
    return normalized.strip()


def require_int(value: str, *, location: str, minimum: int = 0) -> int:
    if value == "":
        raise PrepError(f"Missing integer at {location}.")
    try:
        number = int(value)
    except ValueError as exc:
        raise PrepError(f"Invalid integer at {location}: {value!r}.") from exc
    if number < minimum:
        raise PrepError(f"Integer below {minimum} at {location}: {number}.")
    return number


def require_decimal(value: str, *, location: str) -> Decimal:
    if value == "":
        raise PrepError(f"Missing numeric value at {location}.")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise PrepError(f"Invalid numeric value at {location}: {value!r}.") from exc
    if not number.is_finite():
        raise PrepError(f"Non-finite numeric value at {location}: {value!r}.")
    return number


def competition_ranks(rows: list[dict[str, object]], field: str, descending: bool) -> None:
    ordered = sorted(
        rows,
        key=lambda row: row[field],
        reverse=descending,
    )
    previous: object | None = None
    for position, row in enumerate(ordered, start=1):
        value = row[field]
        if position == 1 or value != previous:
            rank = position
        row[f"{field}_rank" if field != "win_fraction" else "record_rank"] = rank
        previous = value


def decimal_text(value: Decimal) -> str:
    # Decimal preserves the scale supplied by each source cell (for example 7.20).
    return format(value, "f")


def display_win_pct(fraction: Fraction) -> str:
    with localcontext() as context:
        context.prec = 20
        return format(Decimal(fraction.numerator) / Decimal(fraction.denominator), ".6f")


def load_season(path: Path, start: int, end: int, report: Report) -> list[dict[str, object]]:
    label = season_label(start, end)
    try:
        handle = path.open("r", encoding="utf-8-sig", newline="")
    except OSError as exc:
        raise PrepError(f"Could not open {path}: {exc}") from exc

    with handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != EXPECTED_HEADERS:
            raise PrepError(
                f"Unexpected headers in {path.name}. Expected {EXPECTED_HEADERS}; "
                f"found {reader.fieldnames}."
            )
        raw_rows = list(reader)

    rows: list[dict[str, object]] = []
    for line_number, raw in enumerate(raw_rows, start=2):
        if None in raw:
            raise PrepError(f"Unexpected extra column(s) in {path.name}, line {line_number}.")
        location = f"{path.name}, line {line_number}"
        clean = {
            field: normalize_text(value or "", location=f"{location}, {field}", report=report)
            for field, value in raw.items()
        }
        team = clean["Team"]
        if team in SUMMARY_TEAM_LABELS:
            report.excluded_summaries.append(f"{path.name}, line {line_number}: {team}")
            continue
        if not team:
            raise PrepError(f"Missing team name at {location}.")
        if not clean["Conf"] or not clean["Div"]:
            raise PrepError(f"Missing conference or division for {team} at {location}.")

        wins = require_int(clean["W"], location=f"{location}, W")
        losses = require_int(clean["L"], location=f"{location}, L")
        games = wins + losses
        if games == 0:
            raise PrepError(f"W + L is zero for {team} at {location}.")
        source_rank = require_int(clean["Rk"], location=f"{location}, Rk", minimum=1)
        source_win_pct = require_decimal(clean["W/L%"], location=f"{location}, W/L%")
        parsed_ratings = {
            output_name: require_decimal(clean[source_name], location=f"{location}, {source_name}")
            for source_name, output_name in RATING_FIELDS.items()
        }

        unadjusted_delta = abs(
            parsed_ratings["netrtg"] - (parsed_ratings["ortg"] - parsed_ratings["drtg"])
        )
        adjusted_delta = abs(
            parsed_ratings["netrtg_adj"]
            - (parsed_ratings["ortg_adj"] - parsed_ratings["drtg_adj"])
        )
        tolerance = Decimal("0.02")
        if unadjusted_delta > tolerance:
            raise PrepError(
                f"NRtg differs from ORtg - DRtg by {unadjusted_delta} for {team} "
                f"in {label}; tolerance is {tolerance}."
            )
        if adjusted_delta > tolerance:
            raise PrepError(
                f"NRtg/A differs from ORtg/A - DRtg/A by {adjusted_delta} for {team} "
                f"in {label}; tolerance is {tolerance}."
            )
        report.max_unadjusted_net_delta = max(report.max_unadjusted_net_delta, unadjusted_delta)
        report.max_adjusted_net_delta = max(report.max_adjusted_net_delta, adjusted_delta)

        row: dict[str, object] = {
            "season": label,
            "season_start_year": start,
            "season_end_year": end,
            "source_file": path.name,
            "source_url": f"https://www.basketball-reference.com/leagues/NBA_{end}_ratings.html",
            "source_rank": source_rank,
            "team": team,
            "conference": clean["Conf"],
            "division": clean["Div"],
            "wins": wins,
            "losses": losses,
            "games": games,
            "win_fraction": Fraction(wins, games),
            "win_pct": "",  # Filled below from the exact fraction.
            "source_win_pct": source_win_pct,
            **parsed_ratings,
        }
        row["win_pct"] = display_win_pct(row["win_fraction"])
        rows.append(row)

    if len(rows) != 30:
        raise PrepError(
            f"Expected 30 NBA team rows in {path.name} after explicit summary exclusions; "
            f"found {len(rows)}."
        )
    counts = Counter(str(row["team"]) for row in rows)
    duplicates = sorted(team for team, count in counts.items() if count > 1)
    if duplicates:
        raise PrepError(f"Duplicate team(s) in {path.name}: {', '.join(duplicates)}")
    actual_teams = set(counts)
    if actual_teams != EXPECTED_TEAMS:
        missing_teams = sorted(EXPECTED_TEAMS - actual_teams)
        unexpected_teams = sorted(actual_teams - EXPECTED_TEAMS)
        details = []
        if missing_teams:
            details.append("missing: " + ", ".join(missing_teams))
        if unexpected_teams:
            details.append("unexpected: " + ", ".join(unexpected_teams))
        raise PrepError(f"NBA team set mismatch in {path.name} ({'; '.join(details)}).")
    if counts["Washington Wizards"] != 1:
        raise PrepError(
            f"Expected exactly one Washington Wizards row in {path.name}; "
            f"found {counts['Washington Wizards']}."
        )

    competition_ranks(rows, "win_fraction", descending=True)
    competition_ranks(rows, "ortg", descending=True)
    competition_ranks(rows, "drtg", descending=False)
    competition_ranks(rows, "netrtg", descending=True)
    competition_ranks(rows, "ortg_adj", descending=True)
    competition_ranks(rows, "drtg_adj", descending=False)
    competition_ranks(rows, "netrtg_adj", descending=True)
    return rows


def serializable(row: dict[str, object]) -> dict[str, object]:
    result: dict[str, object] = {}
    for field in OUTPUT_FIELDS:
        value = row[field]
        result[field] = decimal_text(value) if isinstance(value, Decimal) else value
    return result


def csv_content(rows: list[dict[str, object]]) -> str:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=OUTPUT_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(serializable(row) for row in rows)
    return buffer.getvalue()


def notes_content(inputs: list[tuple[Path, int, int]], report: Report) -> str:
    source_lines = "\n".join(
        f"- `{path.name}` - {season_label(start, end)} - "
        f"https://www.basketball-reference.com/leagues/NBA_{end}_ratings.html"
        for path, start, end in inputs
    )
    if report.normalization_changes:
        normalization = (
            f"Normalized {len(report.normalization_changes)} text field(s):\n\n"
            + "\n".join(f"- {change}" for change in report.normalization_changes)
        )
    else:
        normalization = (
            "No Markdown `**` markers or HTML entities were present, so no source "
            "values needed text normalization."
        )
    if report.excluded_summaries:
        exclusions = "\n".join(f"- {item}" for item in report.excluded_summaries)
    else:
        exclusions = (
            "No summary rows were present. The only labels eligible for explicit "
            "exclusion were: " + ", ".join(f"`{label}`" for label in sorted(SUMMARY_TEAM_LABELS)) + "."
        )

    return f"""# Team ratings preparation notes

Generated by `scripts/prepare_team_ratings.py` from the 10 local CSV files below. The source files are read-only inputs and are not modified.

## Sources

{source_lines}

## Fields and definitions

- `games` is `wins + losses`.
- `win_pct` is calculated from `wins / games` and emitted to six decimal places. Ranking uses Python's exact integer `Fraction`, never the rounded source `W/L%`. `source_win_pct` retains the supplied value.
- `source_rank` is the supplied `Rk`. It is preserved only as source data and is not reused for any calculated rank.
- Unadjusted fields are `mov`, `ortg`, `drtg`, and the supplied `netrtg`.
- Adjusted fields are `mov_adj`, `ortg_adj`, `drtg_adj`, and the supplied `netrtg_adj`.
- The supplied net ratings are preserved; neither is replaced with an offensive-minus-defensive calculation.
- Chart defaults should use the unadjusted `ortg`, `drtg`, `netrtg` fields and their unadjusted rank fields.

## Ranking

Ranks are leaguewide within each season. `record_rank`, `ortg_rank`, `netrtg_rank`, `ortg_adj_rank`, and `netrtg_adj_rank` sort descending. `drtg_rank` and `drtg_adj_rank` sort ascending because fewer points allowed is better. Ratings are compared as supplied, using exact decimal values without invented tie-breakers. Ties use competition ranking: 1, 2, 2, 4.

## Normalization

{normalization}

## Summary-row exclusions

{exclusions}

## Validation results

- Validated 10 unique seasons and 300 team-season rows (the expected 30 unique NBA teams per season, with no unexpected team rows).
- Validated exactly one Washington Wizards row in each season (10 total).
- Validated required headers and non-missing numeric values for records and ratings.
- Validated unadjusted and adjusted net ratings against the corresponding offensive-minus-defensive differences with an inclusive 0.02-point tolerance.
- Largest observed unadjusted difference: {decimal_text(report.max_unadjusted_net_delta)} points.
- Largest observed adjusted difference: {decimal_text(report.max_adjusted_net_delta)} points.
"""


def main() -> int:
    try:
        inputs = discover_inputs()
        report = Report(normalization_changes=[], excluded_summaries=[])
        all_rows: list[dict[str, object]] = []
        for path, start, end in inputs:
            all_rows.extend(load_season(path, start, end, report))
        wizards = [row for row in all_rows if row["team"] == "Washington Wizards"]
        if len(all_rows) != 300 or len(wizards) != 10:
            raise PrepError(
                f"Final row counts are invalid: {len(all_rows)} total, {len(wizards)} Wizards."
            )

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / "team-ratings-2016-2026.csv").write_text(
            csv_content(all_rows), encoding="utf-8", newline=""
        )
        (OUTPUT_DIR / "wizards-ratings-2016-2026.csv").write_text(
            csv_content(wizards), encoding="utf-8", newline=""
        )
        (OUTPUT_DIR / "team-ratings-prep.notes.md").write_text(
            notes_content(inputs, report), encoding="utf-8", newline="\n"
        )

        print("Washington Wizards prepared rows:")
        print(csv_content(wizards), end="")
        print(
            "Validation summary: 10 seasons; 300 team rows; 30 unique teams and "
            "1 Wizards row per season; "
            f"{len(report.excluded_summaries)} summary rows excluded; "
            f"{len(report.normalization_changes)} text fields normalized; "
            f"max net deltas {decimal_text(report.max_unadjusted_net_delta)} "
            f"unadjusted / {decimal_text(report.max_adjusted_net_delta)} adjusted."
        )
        return 0
    except PrepError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
