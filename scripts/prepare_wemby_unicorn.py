"""Prepare the Wembanyama comparison dataset used by the Spurs preview chart.

The input is the READiscover league CSV. It is already qualified upstream to
2025-26 regular-season players with at least 1,500 minutes; this script verifies
that contract, removes unused columns, normalizes known text-encoding artifacts,
and refuses duplicate player identities.
"""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path


REQUIRED_COLUMNS = {
    "Player",
    "Team",
    "Season",
    "MP",
    "PTS/100 Poss.",
    "DBPM",
    "BLK%",
    "TS%",
    "Pos",
    "Player-additional",
}
OUTPUT_COLUMNS = [
    "player_id",
    "player",
    "team",
    "season",
    "minutes",
    "points_per_100",
    "dbpm",
    "block_pct",
    "true_shooting_pct",
    "position",
]
EXPECTED_WEMBY = {
    "points_per_100": 41.2,
    "dbpm": 4.2,
    "block_pct": 9.4,
    "true_shooting_pct": 0.626,
}
TEXT_REPLACEMENTS = {
    "DonÄiÄ‡": "Dončić",
    "JokiÄ‡": "Jokić",
    "VuÄeviÄ‡": "Vučević",
    "SchrÃ¶der": "Schröder",
    "DiabatÃ©": "Diabaté",
}


def normalize_text(value: str) -> str:
    cleaned = value.strip()
    for broken, replacement in TEXT_REPLACEMENTS.items():
        cleaned = cleaned.replace(broken, replacement)
    return cleaned


def parse_number(value: str, field: str, player: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Invalid {field} for {player or 'an unnamed player'}") from error
    if not math.isfinite(parsed):
        raise ValueError(f"Non-finite {field} for {player or 'an unnamed player'}")
    return parsed


def prepare(source: Path) -> list[dict[str, str | float | int]]:
    with source.open("r", encoding="utf-8-sig", newline="") as source_file:
        reader = csv.reader(source_file)
        try:
            header = next(reader)
        except StopIteration as error:
            raise ValueError("The source CSV is empty") from error

        column_index = {name: index for index, name in enumerate(header)}
        missing = REQUIRED_COLUMNS.difference(column_index)
        if missing:
            raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")

        prepared = []
        player_ids: set[str] = set()
        for source_row in reader:
            if not any(cell.strip() for cell in source_row):
                continue

            player = normalize_text(source_row[column_index["Player"]])
            player_id = source_row[column_index["Player-additional"]].strip()
            if not player or not player_id:
                raise ValueError("Every row must have a player name and stable player ID")
            if player_id in player_ids:
                raise ValueError(f"Duplicate player identity: {player_id}")
            player_ids.add(player_id)

            season = source_row[column_index["Season"]].strip()
            minutes = parse_number(source_row[column_index["MP"]], "minutes", player)
            if season != "2025-26":
                raise ValueError(f"Unexpected season for {player}: {season}")
            if minutes < 1500:
                raise ValueError(f"Qualification failure for {player}: {minutes:g} minutes")

            prepared.append(
                {
                    "player_id": player_id,
                    "player": player,
                    "team": source_row[column_index["Team"]].strip(),
                    "season": season,
                    "minutes": int(minutes),
                    "points_per_100": parse_number(
                        source_row[column_index["PTS/100 Poss."]], "points per 100", player
                    ),
                    "dbpm": parse_number(source_row[column_index["DBPM"]], "DBPM", player),
                    "block_pct": parse_number(source_row[column_index["BLK%"]], "BLK%", player),
                    "true_shooting_pct": parse_number(
                        source_row[column_index["TS%"]], "TS%", player
                    ),
                    "position": source_row[column_index["Pos"]].strip(),
                }
            )

    if not prepared:
        raise ValueError("The source CSV contains no player rows")

    wemby = next((row for row in prepared if row["player_id"] == "wembavi01"), None)
    if wemby is None:
        raise ValueError("Victor Wembanyama is missing from the source population")
    for field, expected in EXPECTED_WEMBY.items():
        if not math.isclose(float(wemby[field]), expected, abs_tol=1e-9):
            raise ValueError(
                f"Wembanyama {field} conflict: expected {expected}, found {wemby[field]}"
            )

    return prepared


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="READiscover wembanyama_unicorn.csv")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/wembanyama-unicorn-2025-26.csv"),
    )
    args = parser.parse_args()

    rows = prepare(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} qualified player rows to {args.output}")


if __name__ == "__main__":
    main()
