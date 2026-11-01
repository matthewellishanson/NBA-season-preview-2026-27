"""Prepare the Portland preview graphics from preserved local exports.

The center comparison reuses the verified Stathead cohort/parser from the Zach
Edey package. Deni Avdija's season rows are joined across player-specific
Basketball Reference exports with explicit season/team/sample checks. No
2026-27 row is included in either chart-ready output.
"""

from __future__ import annotations

import argparse
import csv
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path

from prepare_edey_memphis import QUALIFIER_COUNT, PreparationError, prepare_joined


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "assets" / "data" / "raw"
POR_DIR = RAW_DIR / "POR"
PROCESSED_DIR = ROOT / "assets" / "data" / "processed"

CLINGAN_ID = "clingdo01"
DENI_SEASONS = ("2023-24", "2024-25", "2025-26")
DENI_FILES = {
    "advanced": "Deni_Adv.csv",
    "per100": "Deni_P100P.csv",
    "per_game": "Deni_PerGame.csv",
    "adjusted_shooting": "Deni_AdjShooting.csv",
    "play_by_play": "Deni_PlayByPlay.csv",
    "shooting": "Deni_Shooting.csv",
}
CLINGAN_FILES = {
    "advanced": "Clingan_Adv.csv",
    "per100": "Clingan_P100P.csv",
    "per_game": "Clingan_PerGame.csv",
    "play_by_play": "Clingan_PlayByPlay.csv",
    "shooting": "Clingan_Shooting.csv",
}

CENTER_COLUMNS = (
    "player_id", "player_name", "games", "starts", "total_minutes",
    "source_position", "source_team", "orb_pct", "drb_pct", "blk_pct",
    "orb_per_100", "drb_per_100", "blocks_per_100", "points_per_100",
    "ts_pct", "is_clingan", "source_file_advanced", "source_line_advanced",
    "source_file_per100", "source_line_per100",
)


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


def read_simple_csv(path: Path, *, grouped_header: bool = False) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    header_index = 1 if grouped_header else 0
    if len(rows) <= header_index:
        raise PreparationError(f"{path.name}: missing header or data rows.")
    leaf_header = [cell.strip() for cell in rows[header_index]]
    duplicates = {name for name in leaf_header if leaf_header.count(name) > 1}
    if grouped_header and duplicates:
        groups = [cell.strip() for cell in rows[0]]
        header = [f"{groups[index]}/{name}" if name in duplicates else name for index, name in enumerate(leaf_header)]
    else:
        header = leaf_header
    if len(header) != len(set(header)):
        duplicates = sorted({name for name in header if header.count(name) > 1})
        raise PreparationError(f"{path.name}: grouped headers still contain duplicates: {duplicates}.")
    output: list[dict[str, str]] = []
    for line, values in enumerate(rows[header_index + 1 :], header_index + 2):
        if not any(cell.strip() for cell in values):
            continue
        # Basketball Reference sometimes omits the terminal empty Awards cell.
        if len(values) == len(header) - 1 and header[-1] == "Awards":
            values = [*values, ""]
        if len(values) != len(header):
            raise PreparationError(
                f"{path.name}:{line}: expected {len(header)} fields, found {len(values)}."
            )
        row = {key: value.strip() for key, value in zip(header, values, strict=True)}
        row["__source_line"] = str(line)
        output.append(row)
    return output


def index_seasons(path: Path, *, grouped_header: bool = False) -> dict[str, dict[str, str]]:
    output: dict[str, dict[str, str]] = {}
    for row in read_simple_csv(path, grouped_header=grouped_header):
        season = row.get("Season", "")
        if not season:
            raise PreparationError(f"{path.name}:{row['__source_line']}: missing Season.")
        if season in output:
            raise PreparationError(f"{path.name}: duplicate season record {season}.")
        output[season] = row
    return output


def validate_shared_sample(
    season: str,
    source_rows: dict[str, dict[str, str]],
    *,
    expected_team: str,
) -> None:
    for field in ("Age", "Team", "Lg", "Pos", "G", "GS"):
        values = {row[field] for row in source_rows.values()}
        if len(values) != 1:
            raise PreparationError(f"Deni {season}: shared {field} disagrees across sources: {values}.")
    if next(iter(source_rows.values()))["Team"] != expected_team:
        raise PreparationError(
            f"Deni {season}: expected team {expected_team}, found {next(iter(source_rows.values()))['Team']}."
        )
    total_minute_values = {
        source_rows[key]["MP"] for key in ("advanced", "per100", "adjusted_shooting", "play_by_play", "shooting")
    }
    if len(total_minute_values) != 1:
        raise PreparationError(f"Deni {season}: total minutes disagree: {total_minute_values}.")
    # Per Game MP is minutes per game, not a duplicate total-minutes field.
    decimal(source_rows["per_game"]["MP"], f"Deni {season} MPG")


def prepare_centers() -> tuple[list[dict[str, str]], list[dict[str, str]], dict[str, str]]:
    joined = prepare_joined(RAW_DIR)
    if len(joined) != QUALIFIER_COUNT or len({row["player_id"] for row in joined}) != QUALIFIER_COUNT:
        raise PreparationError("Center cohort did not remain one record per stable player ID.")
    completed_window = {"2024-25", "2025-26"}
    if any(row["from_season"] not in completed_window or row["to_season"] not in completed_window for row in joined):
        raise PreparationError("Center cohort includes a record outside the completed two-season window.")

    centers: list[dict[str, str]] = []
    for row in joined:
        compact = {
            "player_id": row["player_id"],
            "player_name": row["player_name"],
            "games": row["games"],
            "starts": row["starts"],
            "total_minutes": row["total_minutes"],
            "source_position": row["source_position"],
            "source_team": row["source_team"],
            "orb_pct": row["orb_pct"],
            "drb_pct": row["drb_pct"],
            "blk_pct": row["blk_pct"],
            "orb_per_100": row["orb_per_100"],
            "drb_per_100": row["drb_per_100"],
            "blocks_per_100": row["blocks_per_100"],
            "points_per_100": row["points_per_100"],
            "ts_pct": row["ts_pct"],
            "is_clingan": "true" if row["player_id"] == CLINGAN_ID else "false",
            "source_file_advanced": row["advanced_source_file"],
            "source_line_advanced": row["advanced_source_line"],
            "source_file_per100": row["per100_source_file"],
            "source_line_per100": row["per100_source_line"],
        }
        if tuple(compact) != CENTER_COLUMNS:
            raise PreparationError("Center output schema changed unexpectedly.")
        centers.append(compact)

    by_id = {row["player_id"]: row for row in centers}
    clingan = by_id.get(CLINGAN_ID)
    if not clingan or clingan["player_name"] != "Donovan Clingan":
        raise PreparationError("Clingan's stable player ID did not resolve to the expected source record.")
    expected = {
        "games": "144", "starts": "114", "total_minutes": "3418",
        "orb_pct": "17.6", "drb_pct": "27.6", "blk_pct": "6.3",
    }
    for field, value in expected.items():
        if clingan[field] != value:
            raise PreparationError(f"Clingan {field}: expected {value}, found {clingan[field]}.")

    profile: list[dict[str, str]] = []
    for metric, label in (
        ("orb_pct", "Offensive rebound percentage"),
        ("drb_pct", "Defensive rebound percentage"),
        ("blk_pct", "Block percentage"),
    ):
        observations = [decimal(row[metric], f"{row['player_id']} {metric}") for row in centers]
        value = decimal(clingan[metric], f"Clingan {metric}")
        rank = 1 + sum(observation > value for observation in observations)
        tie_count = sum(observation == value for observation in observations)
        profile.append({
            "player_id": CLINGAN_ID,
            "player_name": "Donovan Clingan",
            "metric_key": metric,
            "metric_label": label,
            "source_value": clingan[metric],
            "display_value": f"{value:.1f}%",
            "rank": str(rank),
            "rank_display": f"T-{rank}" if tie_count > 1 else str(rank),
            "tie_count": str(tie_count),
            "valid_qualifiers": str(len(observations)),
            "ranking_method": "descending_competition_rank_strictly_higher",
        })
    expected_ranks = {"orb_pct": ("3", "1"), "drb_pct": ("14", "1"), "blk_pct": ("7", "2")}
    for row in profile:
        if (row["rank"], row["tie_count"]) != expected_ranks[row["metric_key"]]:
            raise PreparationError(f"Unexpected Clingan rank/tie result for {row['metric_key']}.")
    return centers, profile, clingan


def prepare_deni() -> list[dict[str, str]]:
    sources = {
        key: index_seasons(POR_DIR / filename, grouped_header=key in {"adjusted_shooting", "play_by_play", "shooting"})
        for key, filename in DENI_FILES.items()
    }
    output: list[dict[str, str]] = []
    for season in DENI_SEASONS:
        source_rows = {key: rows[season] for key, rows in sources.items()}
        team = "WAS" if season == "2023-24" else "POR"
        validate_shared_sample(season, source_rows, expected_team=team)
        adv = source_rows["advanced"]
        p100 = source_rows["per100"]
        per_game = source_rows["per_game"]
        adjusted = source_rows["adjusted_shooting"]
        if adv["TS%"] != adjusted["TS%"] or adv["FTr"] != adjusted["FTr"]:
            raise PreparationError(f"Deni {season}: Advanced and Adjusted Shooting rates disagree.")
        if p100["AST"] == per_game["AST"]:
            raise PreparationError(f"Deni {season}: AST/100 unexpectedly equals AST/game; units may be confused.")
        row = {
            "player_name": "Deni Avdija",
            "season": season,
            "team": team,
            "age": adv["Age"],
            "position": adv["Pos"],
            "games": adv["G"],
            "starts": adv["GS"],
            "total_minutes": adv["MP"],
            "minutes_per_game": per_game["MP"],
            "usage_pct": adv["USG%"],
            "assists_per_100": p100["AST"],
            "assists_per_game": per_game["AST"],
            "free_throw_rate": adjusted["FTr"],
            "fta_per_100_fga": str(decimal(adjusted["FTr"], f"Deni {season} FTr") * 100),
            "true_shooting_pct": adjusted["TS%"],
            "points_per_game": per_game["PTS"],
            "field_goal_attempts_per_game": per_game["FGA"],
            "free_throw_attempts_per_game": per_game["FTA"],
            "three_point_attempts_per_game": per_game["3PA"],
            "three_point_pct": per_game["3P%"],
            "points_per_100": p100["PTS"],
            "turnovers_per_100": p100["TOV"],
            "assist_pct": adv["AST%"],
            "turnover_pct": adv["TOV%"],
            "source_files": "|".join(DENI_FILES.values()),
            "source_rows_json": json.dumps(
                {key: {k: v for k, v in value.items() if k != "__source_line"} for key, value in source_rows.items()},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        }
        output.append(row)

    expected = {
        "2023-24": ("75", "30.1", "20.2", "5.9", ".340", ".597"),
        "2024-25": ("72", "30.0", "23.2", "6.3", ".441", ".605"),
        "2025-26": ("66", "33.3", "29.3", "9.6", ".573", ".600"),
    }
    for row in output:
        actual = tuple(row[key] for key in (
            "games", "minutes_per_game", "usage_pct", "assists_per_100", "free_throw_rate", "true_shooting_pct"
        ))
        if actual != expected[row["season"]]:
            raise PreparationError(f"Deni {row['season']}: validation anchors disagree: {actual}.")
    return output


def validate_clingan_year_two() -> dict[str, str]:
    sources = {
        key: index_seasons(POR_DIR / filename, grouped_header=key in {"play_by_play", "shooting"})
        for key, filename in CLINGAN_FILES.items()
    }
    rows = {key: source["2025-26"] for key, source in sources.items()}
    for field in ("Age", "Team", "Lg", "Pos", "G", "GS"):
        if len({row[field] for row in rows.values()}) != 1:
            raise PreparationError(f"Clingan 2025-26: {field} disagrees across career exports.")
    expected = {
        "games": rows["per_game"]["G"],
        "starts": rows["per_game"]["GS"],
        "total_minutes": rows["advanced"]["MP"],
        "rebounds_per_game": rows["per_game"]["TRB"],
        "offensive_rebounds_per_game": rows["per_game"]["ORB"],
        "three_point_pct": rows["per_game"]["3P%"],
        "three_point_attempts_per_game": rows["per_game"]["3PA"],
    }
    if tuple(expected.values()) != ("77", "77", "2094", "11.6", "4.5", ".341", "3.2"):
        raise PreparationError(f"Clingan 2025-26 supporting values disagree: {expected}.")
    return expected


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def notes_text(profile: list[dict[str, str]], year_two: dict[str, str]) -> str:
    ranks = ", ".join(
        f"{row['metric_key']} {row['display_value']} ({row['rank_display']} of {row['valid_qualifiers']})"
        for row in profile
    )
    return f"""# Portland preview data preparation notes

## Source files and coverage

- The center comparison is regenerated from `assets/data/raw/FrontcourtOnly_202425to202526_Min1000MIN_Adv.csv` and `assets/data/raw/P100PStats_FrontcourtOnly_202425to202526_Min1000MIN.csv`, the same local exports and parser used by the Zach Edey graphic. The requested `(1)` filename variants are not present in the repository; the verified files are the unsuffixed paths above.
- Those exports contain source-aggregated player records for the 2024-25 and 2025-26 regular seasons combined. The Stathead query population is players filtered as C or C/F with at least 1,000 total minutes across the window. It is not every NBA big man.
- The Advanced export has one leaf header row. The Per 100 export has a grouping row followed by its leaf header. Advanced `Player-additional` and Per 100 `-9999` contain stable Basketball Reference player IDs. Both sources contain the same 72 unique IDs; the join is one-to-one by ID.
- The Portland career inputs are the eleven requested `Clingan_*.csv` and `Deni_*.csv` files under `assets/data/raw/POR/`. Grouped two-row headers in Adjusted Shooting, Play-by-Play and Shooting are parsed explicitly. The player-specific career files do not include a stable ID column, so Deni seasons are joined by season only after age, team, league, position, games and starts agree across files. No aggregate `TOT` or separate team-stint rows occur in the three selected Deni seasons.
- Both outputs exclude every 2026-27 row. The four-game current-season records remain preserved in raw inputs but are not transformed into either graphic.

## Center aggregation, units and ranks

- The supplied center records already contain correctly aggregated two-season percentage fields. ORB%, DRB% and BLK% are read directly; no season percentages are averaged or minutes-weighted. Per-100 rows validate identity, 144 combined games, 114 starts and 3,418 total minutes for Donovan Clingan (`clingdo01`).
- `MP` in the cohort export is total minutes, not minutes per game. ORB%, DRB% and BLK% are percentage-point values. Missing cells remain missing in the normalized parser and are not replaced with zero.
- Ranks use descending competition rank on source precision: 1 plus the number of valid qualifiers with a strictly higher value. Tied values share a rank. Verified Clingan profile: {ranks}.
- BLK% estimates the share of opponent two-point attempts blocked while the player is on court. It does not measure complete defensive quality, rim deterrence or wins caused.

## Deni joins and units

- `portland-deni-offense-2023-2026.csv` keeps one row each for 2023-24 Washington, 2024-25 Portland and 2025-26 Portland. Advanced supplies USG%; Per 100 supplies AST/100; Adjusted Shooting supplies FTr and TS%; Per Game supplies games, MPG and editorial context. Source rows are retained as JSON for auditability.
- The Advanced/Per 100 `MP` fields are total minutes. Per Game `MP` is MPG and is stored separately. FTr and TS% are source fractions already in percentage units; chart labels multiply them by 100 for display. `fta_per_100_fga` is FTr multiplied by 100 and means free-throw attempts per 100 field-goal attempts, not per 100 possessions.
- Source AST/100 values are 5.9, 6.3 and 9.6. They are not substituted with per-game assists (3.8, 3.9 and 6.7). Empty source values remain empty; zero is retained only when the source explicitly reports zero.

## Supporting context and limitations

- Clingan's completed 2025-26 career rows verify {year_two['games']} games, {year_two['starts']} starts, {year_two['rebounds_per_game']} rebounds per game, {year_two['offensive_rebounds_per_game']} offensive rebounds per game, {Decimal(year_two['three_point_pct']) * 100:.1f}% from three and {year_two['three_point_attempts_per_game']} three-point attempts per game.
- Deni's three seasons describe role, playmaking volume, foul-drawing rate and scoring efficiency. They do not establish causation, a league-wide foul-drawing rank or a particular foul-drawing technique.
"""


def main() -> None:
    global RAW_DIR, POR_DIR
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--por-dir", type=Path, default=POR_DIR)
    parser.add_argument("--output-dir", type=Path, default=PROCESSED_DIR)
    args = parser.parse_args()
    RAW_DIR = args.raw_dir.resolve()
    POR_DIR = args.por_dir.resolve()

    centers, profile, _ = prepare_centers()
    deni = prepare_deni()
    year_two = validate_clingan_year_two()
    output_dir = args.output_dir.resolve()
    write_csv(output_dir / "portland-centers-2024-2026.csv", centers)
    write_csv(output_dir / "portland-clingan-rank-profile.csv", profile)
    write_csv(output_dir / "portland-deni-offense-2023-2026.csv", deni)
    (output_dir / "portland-preview-prep.notes.md").write_text(
        notes_text(profile, year_two), encoding="utf-8"
    )
    print("PASS: 72 unique two-season center records; Clingan ranks 3, 14 and T-7.")
    print("PASS: Deni 2023-24 through 2025-26 joined across six career exports; 2026-27 excluded.")


if __name__ == "__main__":
    main()
