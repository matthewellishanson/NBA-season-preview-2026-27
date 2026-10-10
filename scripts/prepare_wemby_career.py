"""Join and normalize Victor Wembanyama's five Basketball Reference exports.

Grouped headers are mapped by explicit column position so repeated leaf names
such as ``% of``, ``FG%``, ``Shoot`` and ``Off.`` can never overwrite one
another silently.
"""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path


SEASONS = ("2023-24", "2024-25", "2025-26")
FILES = {
    "advanced": "WembyAdv.csv",
    "per100": "WembyP100.csv",
    "adjusted": "WembyAdjustedShooting.csv",
    "shooting": "WembyShooting.csv",
    "playbyplay": "WembyPlayByPlay.csv",
}
IDENTITY_COLUMNS = {
    "season": 0,
    "age": 1,
    "team": 2,
    "league": 3,
    "position": 4,
    "games": 5,
    "games_started": 6,
    "minutes": 7,
}

ADVANCED_FIELDS = {
    "adv_per": 8,
    "adv_ts_pct": 9,
    "adv_three_point_attempt_rate": 10,
    "adv_free_throw_attempt_rate": 11,
    "adv_orb_pct": 12,
    "adv_drb_pct": 13,
    "adv_trb_pct": 14,
    "adv_ast_pct": 15,
    "adv_stl_pct": 16,
    "adv_blk_pct": 17,
    "adv_tov_pct": 18,
    "adv_usage_pct": 19,
    "adv_ows": 20,
    "adv_dws": 21,
    "adv_ws": 22,
    "adv_ws_per_48": 23,
    "adv_obpm": 24,
    "adv_dbpm": 25,
    "adv_bpm": 26,
    "adv_vorp": 27,
}

PER100_FIELDS = {
    "p100_fg": 8,
    "p100_fga": 9,
    "p100_fg_pct": 10,
    "p100_three_p": 11,
    "p100_three_pa": 12,
    "p100_three_p_pct": 13,
    "p100_two_p": 14,
    "p100_two_pa": 15,
    "p100_two_p_pct": 16,
    "p100_efg_pct": 17,
    "p100_ft": 18,
    "p100_fta": 19,
    "p100_ft_pct": 20,
    "p100_orb": 21,
    "p100_drb": 22,
    "p100_trb": 23,
    "p100_ast": 24,
    "p100_stl": 25,
    "p100_blk": 26,
    "p100_tov": 27,
    "p100_pf": 28,
    "p100_pts": 29,
    "p100_individual_ortg": 30,
    "p100_individual_drtg": 31,
}

ADJUSTED_SCHEMA = {
    8: ("Shoo", "FG%", "adjusted_source_fg_pct"),
    9: ("Shoo", "2P%", "adjusted_source_two_p_pct"),
    10: ("Shoo", "3P%", "adjusted_source_three_p_pct"),
    11: ("Shoo", "eFG%", "adjusted_source_efg_pct"),
    12: ("Shoo", "FT%", "adjusted_source_ft_pct"),
    13: ("Shoo", "TS%", "adjusted_source_ts_pct"),
    14: ("Shoo", "FTr", "adjusted_source_free_throw_attempt_rate"),
    15: ("Shoo", "3PAr", "adjusted_source_three_point_attempt_rate"),
    16: ("Leag", "FG+", "league_relative_fg_index"),
    17: ("Leag", "2P+", "league_relative_two_p_index"),
    18: ("Leag", "3P+", "league_relative_three_p_index"),
    19: ("Leag", "eFG+", "league_relative_efg_index"),
    20: ("Leag", "FT+", "league_relative_ft_index"),
    21: ("Leag", "TS+", "league_relative_ts_index"),
    22: ("Leag", "FTr+", "league_relative_free_throw_rate_index"),
    23: ("Leag", "3PAr+", "league_relative_three_point_rate_index"),
    24: ("Adde", "FG Add", "adjusted_fg_added"),
    25: ("Adde", "TS Add", "adjusted_ts_added"),
}

SHOOTING_SCHEMA = {
    8: ("", "FG%", "shooting_source_fg_pct"),
    9: ("", "Dist.", "shooting_average_distance_ft"),
    10: ("% of", "2P", "shooting_attempt_share_two_p"),
    11: ("% of", "0-3", "shooting_attempt_share_0_3_ft"),
    12: ("% of", "3-10", "shooting_attempt_share_3_10_ft"),
    13: ("% of", "10-16", "shooting_attempt_share_10_16_ft"),
    14: ("% of", "16-3P", "shooting_attempt_share_16_ft_to_three"),
    15: ("% of", "3P", "shooting_attempt_share_three_p"),
    16: ("FG%", "2P", "shooting_accuracy_two_p"),
    17: ("FG%", "0-3", "shooting_accuracy_0_3_ft"),
    18: ("FG%", "3-10", "shooting_accuracy_3_10_ft"),
    19: ("FG%", "10-16", "shooting_accuracy_10_16_ft"),
    20: ("FG%", "16-3P", "shooting_accuracy_16_ft_to_three"),
    21: ("FG%", "3P", "shooting_accuracy_three_p"),
    22: ("% of", "2P", "shooting_assisted_share_made_two_p"),
    23: ("% of", "3P", "shooting_assisted_share_made_three_p"),
    24: ("Dunk", "%FGA", "shooting_dunk_attempt_share"),
    25: ("Dunk", "#", "shooting_dunks_made"),
    26: ("Corn", "%3PA", "shooting_corner_three_attempt_share"),
    27: ("Corn", "3P%", "shooting_corner_three_pct"),
    28: ("1/2", "Att.", "shooting_halfcourt_attempts"),
    29: ("1/2", "Md.", "shooting_halfcourt_makes"),
}

PLAY_BY_PLAY_SCHEMA = {
    8: ("Posi", "PG%", "play_position_pg_pct"),
    9: ("Posi", "SG%", "play_position_sg_pct"),
    10: ("Posi", "SF%", "play_position_sf_pct"),
    11: ("Posi", "PF%", "play_position_pf_pct"),
    12: ("Posi", "C%", "play_position_c_pct"),
    13: ("+/-", "OnCourt", "play_oncourt_net_rating_per_100"),
    14: ("+/-", "On-Off", "play_onoff_net_rating_per_100"),
    15: ("Turn", "BadPass", "play_bad_pass_turnovers"),
    16: ("Turn", "LostBall", "play_lost_ball_turnovers"),
    17: ("Foul", "Shoot", "play_shooting_fouls_committed"),
    18: ("Foul", "Off.", "play_offensive_fouls_committed"),
    19: ("Foul", "Shoot", "play_shooting_fouls_drawn"),
    20: ("Foul", "Off.", "play_offensive_fouls_drawn"),
    21: ("Misc", "PGA", "play_points_generated_by_assists"),
    22: ("Misc", "And1", "play_and_one_made_field_goals"),
    23: ("Misc", "Blkd", "play_field_goal_attempts_blocked"),
}

INTEGER_FIELDS = {
    "age", "games", "games_started", "minutes", "shooting_dunks_made",
    "shooting_halfcourt_attempts", "shooting_halfcourt_makes",
    "play_bad_pass_turnovers", "play_lost_ball_turnovers",
    "play_shooting_fouls_committed", "play_offensive_fouls_committed",
    "play_shooting_fouls_drawn", "play_offensive_fouls_drawn",
    "play_points_generated_by_assists", "play_and_one_made_field_goals",
    "play_field_goal_attempts_blocked",
}
TEXT_FIELDS = {"season", "team", "league", "position"}


def read_rows(path: Path, grouped: bool) -> tuple[list[str], list[str], list[list[str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))
    if grouped:
        if len(rows) != 5:
            raise ValueError(f"{path.name}: expected two header rows and three seasons")
        return rows[0], rows[1], rows[2:]
    if len(rows) != 4:
        raise ValueError(f"{path.name}: expected one header row and three seasons")
    return [""] * len(rows[0]), rows[0], rows[1:]


def parse_value(field: str, value: str) -> str | int | float:
    if field in TEXT_FIELDS:
        return value.strip()
    if field in INTEGER_FIELDS:
        return int(value)
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"Non-finite value for {field}")
    return parsed


def map_rows(
    path: Path,
    grouped: bool,
    fields: dict[str, int] | None = None,
    schema: dict[int, tuple[str, str, str]] | None = None,
) -> dict[str, dict[str, str | int | float]]:
    groups, leaves, rows = read_rows(path, grouped)
    mapped: dict[str, dict[str, str | int | float]] = {}
    for raw in rows:
        identity = {field: parse_value(field, raw[index]) for field, index in IDENTITY_COLUMNS.items()}
        season = str(identity["season"])
        record = dict(identity)
        if fields:
            record.update({field: parse_value(field, raw[index]) for field, index in fields.items()})
        if schema:
            for index, (expected_group, expected_leaf, field) in schema.items():
                if groups[index] != expected_group or leaves[index] != expected_leaf:
                    raise ValueError(
                        f"{path.name} column {index}: expected {expected_group}/{expected_leaf}, "
                        f"found {groups[index]}/{leaves[index]}"
                    )
                record[field] = parse_value(field, raw[index])
        if season in mapped:
            raise ValueError(f"{path.name}: duplicate season {season}")
        mapped[season] = record
    if tuple(mapped) != SEASONS:
        raise ValueError(f"{path.name}: expected seasons {SEASONS}, found {tuple(mapped)}")
    return mapped


def assert_equal(season: str, label: str, *values: object) -> None:
    if len(set(values)) != 1:
        raise ValueError(f"{season}: {label} conflict: {values}")


def prepare(raw_dir: Path) -> list[dict[str, str | int | float]]:
    sources = {
        "advanced": map_rows(raw_dir / FILES["advanced"], False, ADVANCED_FIELDS),
        "per100": map_rows(raw_dir / FILES["per100"], False, PER100_FIELDS),
        "adjusted": map_rows(raw_dir / FILES["adjusted"], True, schema=ADJUSTED_SCHEMA),
        "shooting": map_rows(raw_dir / FILES["shooting"], True, schema=SHOOTING_SCHEMA),
        "playbyplay": map_rows(raw_dir / FILES["playbyplay"], True, schema=PLAY_BY_PLAY_SCHEMA),
    }
    output = []
    for season in SEASONS:
        rows = [source[season] for source in sources.values()]
        for field in IDENTITY_COLUMNS:
            assert_equal(season, field, *(row[field] for row in rows))

        adv, per100, adjusted, shooting, play = rows
        assert_equal(season, "TS%", adv["adv_ts_pct"], adjusted["adjusted_source_ts_pct"])
        assert_equal(
            season,
            "FTr",
            adv["adv_free_throw_attempt_rate"],
            adjusted["adjusted_source_free_throw_attempt_rate"],
        )
        assert_equal(
            season,
            "3PAr",
            adv["adv_three_point_attempt_rate"],
            adjusted["adjusted_source_three_point_attempt_rate"],
        )
        for label, values in {
            "FG%": (per100["p100_fg_pct"], adjusted["adjusted_source_fg_pct"], shooting["shooting_source_fg_pct"]),
            "2P%": (per100["p100_two_p_pct"], adjusted["adjusted_source_two_p_pct"], shooting["shooting_accuracy_two_p"]),
            "3P%": (per100["p100_three_p_pct"], adjusted["adjusted_source_three_p_pct"], shooting["shooting_accuracy_three_p"]),
            "eFG%": (per100["p100_efg_pct"], adjusted["adjusted_source_efg_pct"]),
            "FT%": (per100["p100_ft_pct"], adjusted["adjusted_source_ft_pct"]),
        }.items():
            assert_equal(season, label, *values)

        combined = dict(adv)
        for row in (per100, adjusted, shooting, play):
            combined.update({key: value for key, value in row.items() if key not in IDENTITY_COLUMNS})
        combined["derived_unassisted_share_made_two_p"] = round(
            1 - float(combined["shooting_assisted_share_made_two_p"]), 3
        )
        combined["derived_unassisted_share_made_three_p"] = round(
            1 - float(combined["shooting_assisted_share_made_three_p"]), 3
        )
        combined["derived_shot_zone_attempt_share_total"] = round(
            sum(
                float(combined[field])
                for field in (
                    "shooting_attempt_share_0_3_ft",
                    "shooting_attempt_share_3_10_ft",
                    "shooting_attempt_share_10_16_ft",
                    "shooting_attempt_share_16_ft_to_three",
                    "shooting_attempt_share_three_p",
                )
            ),
            3,
        )
        output.append(combined)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=Path("assets/data/raw"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/data/processed/wembanyama-career-2023-2026.csv"),
    )
    args = parser.parse_args()
    rows = prepare(args.raw_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} joined seasons to {args.output}")


if __name__ == "__main__":
    main()
