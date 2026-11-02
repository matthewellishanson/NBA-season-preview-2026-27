"""Prepare Cooper Flagg's season-age historical scoring comparison.

The supplied Stathead exports are already aggregated to one record per player.
This script preserves that grain, joins the Advanced and Per 100 exports on the
stable Basketball-Reference player ID, and writes only the top 10 total scorers.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


RAW_ADV = "MostPointsBeforeTurning20_Adv.csv"
RAW_P100 = "MostPointsBeforeTurning20_P100P.csv"
RAW_FIRST_75 = "First75Games.csv"
EXPECTED_ANCHORS = {
    "bryanko01": (1, "Kobe Bryant", 1759, 150, "1996-97", "1997-98", "18-19"),
    "anthoca01": (2, "Carmelo Anthony", 1725, 82, "2003-04", "2003-04", "19"),
    "jamesle01": (3, "LeBron James", 1654, 79, "2003-04", "2003-04", "19"),
    "duranke01": (4, "Kevin Durant", 1624, 80, "2007-08", "2007-08", "19"),
    "doncilu01": (5, "Luka Dončić", 1526, 72, "2018-19", "2018-19", "19"),
    "flaggco01": (6, "Cooper Flagg", 1473, 70, "2025-26", "2025-26", "19"),
}
OUTPUT_COLUMNS = [
    "rank",
    "player_id",
    "player_name",
    "total_points",
    "games",
    "season_from",
    "season_to",
    "season_span",
    "age_designation",
    "team",
    "points_per_100",
]


class PreparationError(ValueError):
    """Raised when a supplied export does not match the expected contract."""


def _read_rows(path: Path, *, skip_grouping_row: bool = False) -> tuple[list[str], list[list[str]]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    if skip_grouping_row:
        if not rows or "Per 100 Possessions" not in rows[0]:
            raise PreparationError(f"{path.name}: expected leading grouping row.")
        rows = rows[1:]
    if len(rows) < 2:
        raise PreparationError(f"{path.name}: no data rows found.")
    header, data = rows[0], rows[1:]
    if any(len(row) != len(header) for row in data):
        raise PreparationError(f"{path.name}: row width does not match header width.")
    return header, data


def _index(header: list[str], name: str, occurrence: int = 1) -> int:
    matches = [index for index, value in enumerate(header) if value == name]
    if len(matches) < occurrence:
        raise PreparationError(f"Missing column {name!r}, occurrence {occurrence}.")
    return matches[occurrence - 1]


def _records(header: list[str], rows: list[list[str]], *, id_column: str) -> dict[str, list[str]]:
    id_index = _index(header, id_column)
    records: dict[str, list[str]] = {}
    for row in rows:
        player_id = row[id_index].strip()
        if not player_id:
            raise PreparationError("Encountered a row without a Basketball-Reference player ID.")
        if player_id in records:
            raise PreparationError(f"Duplicate aggregated record for {player_id}.")
        records[player_id] = row
    return records


def _season_span(season_from: str, season_to: str) -> str:
    if season_from == season_to:
        return season_from
    return f"{season_from}–{season_to}"


def _validate_first_75(path: Path) -> None:
    header, rows = _read_rows(path)
    records = _records(header, rows, id_column="Player-additional")
    row = records.get("flaggco01")
    if row is None:
        raise PreparationError("First75Games.csv: Cooper Flagg is missing.")
    values = {
        "rank": int(row[_index(header, "Rk")]),
        "points": int(row[_index(header, "PTS", 1)]),
        "games": int(row[_index(header, "G")]),
    }
    if values != {"rank": 34, "points": 1607, "games": 75}:
        raise PreparationError(f"First75Games.csv: unexpected Flagg validation row {values}.")


def prepare(raw_dir: Path) -> list[dict[str, str | int | float]]:
    adv_header, adv_rows = _read_rows(raw_dir / RAW_ADV)
    p100_header, p100_rows = _read_rows(raw_dir / RAW_P100, skip_grouping_row=True)
    adv = _records(adv_header, adv_rows, id_column="Player-additional")
    p100 = _records(p100_header, p100_rows, id_column="-9999")
    if set(adv) != set(p100):
        raise PreparationError("Advanced and Per 100 exports do not contain identical player-ID sets.")

    adv_fields = {name: _index(adv_header, name) for name in ("Rk", "Player", "PTS", "From", "To", "Age", "G", "Team")}
    p100_fields = {
        "Player": _index(p100_header, "Player"),
        "total_points": _index(p100_header, "PTS", 1),
        "points_per_100": _index(p100_header, "PTS", 2),
        "From": _index(p100_header, "From"),
        "To": _index(p100_header, "To"),
        "Age": _index(p100_header, "Age"),
        "G": _index(p100_header, "G"),
        "Team": _index(p100_header, "Team"),
    }

    output: list[dict[str, str | int | float]] = []
    for player_id, adv_row in adv.items():
        p100_row = p100[player_id]
        shared = ("Player", "From", "To", "Age", "G", "Team")
        for field in shared:
            if adv_row[adv_fields[field]] != p100_row[p100_fields[field]]:
                raise PreparationError(f"{player_id}: {field} differs between exports.")
        total_points = int(adv_row[adv_fields["PTS"]])
        if total_points != int(p100_row[p100_fields["total_points"]]):
            raise PreparationError(f"{player_id}: total-points columns disagree.")
        rank = int(adv_row[adv_fields["Rk"]])
        if rank <= 10:
            season_from = adv_row[adv_fields["From"]]
            season_to = adv_row[adv_fields["To"]]
            output.append({
                "rank": rank,
                "player_id": player_id,
                "player_name": adv_row[adv_fields["Player"]],
                "total_points": total_points,
                "games": int(adv_row[adv_fields["G"]]),
                "season_from": season_from,
                "season_to": season_to,
                "season_span": _season_span(season_from, season_to),
                "age_designation": adv_row[adv_fields["Age"]],
                "team": adv_row[adv_fields["Team"]],
                "points_per_100": float(p100_row[p100_fields["points_per_100"]]),
            })

    output.sort(key=lambda row: (-int(row["total_points"]), int(row["rank"])))
    if [int(row["rank"]) for row in output] != list(range(1, 11)):
        raise PreparationError("Top-10 output does not contain source ranks 1 through 10.")
    if len({str(row["player_id"]) for row in output}) != 10:
        raise PreparationError("Top-10 output is not one aggregated record per player.")

    by_id = {str(row["player_id"]): row for row in output}
    for player_id, expected in EXPECTED_ANCHORS.items():
        row = by_id.get(player_id)
        actual = None if row is None else (
            row["rank"], row["player_name"], row["total_points"], row["games"],
            row["season_from"], row["season_to"], row["age_designation"],
        )
        if actual != expected:
            raise PreparationError(f"{player_id}: validation anchor mismatch: {actual!r}.")

    _validate_first_75(raw_dir / RAW_FIRST_75)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw/DAL"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/flagg-season-age-scoring.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} chart rows to {args.output}.")
    print("Validated one-to-one player-ID joins, duplicate PTS mappings, ranks 1-10, and six anchors.")
    print("Validated First75Games.csv separately: Flagg ranks 34th with 1,607 points in 75 games.")


if __name__ == "__main__":
    main()
