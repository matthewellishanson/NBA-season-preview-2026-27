#!/usr/bin/env python3
"""Validate supplied Miami preview exports and build chart-ready datasets."""

from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "data" / "raw"
OUT = ROOT / "assets" / "data" / "processed"


def read_flat(name: str) -> list[dict[str, str]]:
    path = RAW / name
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    if not rows:
        raise ValueError(f"{name}: no data rows")
    return rows


def read_grouped(name: str) -> list[dict[str, str]]:
    """Read two-row Basketball-Reference headers without losing duplicate names."""
    path = RAW / name
    with path.open(encoding="utf-8-sig", newline="") as source:
        raw = list(csv.reader(source))
    if len(raw) < 3 or len(raw[0]) != len(raw[1]):
        raise ValueError(f"{name}: grouped header structure changed")
    keys: list[str] = []
    seen: dict[str, int] = {}
    for group, field in zip(raw[0], raw[1], strict=True):
        base = f"{group.strip() or 'Identity'}::{field.strip()}"
        seen[base] = seen.get(base, 0) + 1
        keys.append(base if seen[base] == 1 else f"{base}__{seen[base]}")
    rows = []
    for row in raw[2:]:
        if not row:
            continue
        if len(row) != len(keys):
            raise ValueError(f"{name}: row width differs from grouped headers")
        rows.append(dict(zip(keys, row, strict=True)))
    return rows


def by_season(rows: list[dict[str, str]], name: str) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for row in rows:
        season = row["Season"].strip()
        team = row["Team"].strip()
        if season in result:
            raise ValueError(f"{name}: aggregate/team-stint duplicate for {season}; select explicitly")
        if team in {"2TM", "3TM"}:
            raise ValueError(f"{name}: unexpected aggregate row for {season}")
        result[season] = row
    return result


def by_player(rows: list[dict[str, str]], name: str) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for row in rows:
        player_id = row["Player-additional"].strip()
        if not player_id or player_id in result:
            raise ValueError(f"{name}: missing or duplicate stable player id {player_id!r}")
        result[player_id] = row
    return result


def write_csv(name: str, rows: list[dict[str, object]]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / name).open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    klay_pg = by_season(read_flat("Klay_PerGame.csv"), "Klay per-game")
    klay_p100 = by_season(read_flat("Klay_P100P.csv"), "Klay per-100")
    klay_adv = by_season(read_flat("Klay_Adv.csv"), "Klay advanced")
    klay_adj_rows = read_grouped("Klay_AdjShooting.csv")
    klay_adj = {row["Identity::Season"]: row for row in klay_adj_rows}
    if len(klay_adj) != len(klay_adj_rows):
        raise ValueError("Klay adjusted shooting: duplicate season rows")

    klay_rows: list[dict[str, object]] = []
    for ending_year in range(2015, 2028):
        season = f"{ending_year - 1}-{str(ending_year)[-2:]}"
        if season not in klay_pg:
            klay_rows.append({
                "player_id": "thompkl01", "season": season, "team": "", "status": "absence",
                "games": "", "minutes_per_game": "", "total_minutes": "", "three_pct": "",
                "three_attempts_per_game": "", "three_point_attempt_rate": "", "two_pct": "",
                "two_attempts_per_game": "", "true_shooting_pct": "", "three_plus": "",
            })
            continue
        pg, p100, adv, adj = klay_pg[season], klay_p100[season], klay_adv[season], klay_adj[season]
        if len({pg["Team"], p100["Team"], adv["Team"], adj["Identity::Team"]}) != 1:
            raise ValueError(f"Klay {season}: team keys disagree")
        if len({pg["G"], p100["G"], adv["G"], adj["Identity::G"]}) != 1:
            raise ValueError(f"Klay {season}: games disagree")
        if len({p100["MP"], adv["MP"], adj["Identity::MP"]}) != 1 or pg["MP"] == adv["MP"]:
            raise ValueError(f"Klay {season}: total minutes and MPG are inconsistent")
        status = "snapshot" if season == "2026-27" else "completed"
        klay_rows.append({
            "player_id": "thompkl01", "season": season, "team": pg["Team"], "status": status,
            "games": pg["G"], "minutes_per_game": pg["MP"], "total_minutes": adv["MP"],
            "three_pct": pg["3P%"], "three_attempts_per_game": pg["3PA"],
            "three_point_attempt_rate": adv["3PAr"], "two_pct": pg["2P%"],
            "two_attempts_per_game": pg["2PA"], "true_shooting_pct": adv["TS%"],
            "three_plus": adj["League-Adjusted::3P+"],
        })
    expected_klay = klay_rows[-2]
    if tuple(expected_klay[key] for key in ("games", "minutes_per_game", "three_pct", "three_attempts_per_game", "three_point_attempt_rate", "two_pct", "true_shooting_pct", "three_plus")) != ("69", "21.7", ".383", "7.6", ".724", ".418", ".541", "107"):
        raise ValueError("Klay 2025-26 validation anchors changed")
    write_csv("heat-klay-offense-2014-2027.csv", klay_rows)

    bam_pg = by_season(read_flat("Bam_PerGame.csv"), "Bam per-game")
    bam_adv = by_season(read_flat("Bam_Adv.csv"), "Bam advanced")
    bam_shooting_rows = read_grouped("Bam_Shooting.csv")
    bam_shooting = {row["Identity::Season"]: row for row in bam_shooting_rows}
    giannis_pg = by_season(read_flat("Giannis_PerGame.csv"), "Giannis per-game")
    giannis_p100 = by_season(read_flat("Giannis_P100P.csv"), "Giannis per-100")
    giannis_adv = by_season(read_flat("Giannis_Adv.csv"), "Giannis advanced")
    giannis_shooting_rows = read_grouped("Giannis_Shooting.csv")
    giannis_shooting = {row["Identity::Season"]: row for row in giannis_shooting_rows}

    bam_role = []
    for season in ("2023-24", "2024-25", "2025-26"):
        pg, adv = bam_pg[season], bam_adv[season]
        bam_role.append({
            "player_id": "adebaba01", "season": season, "team": pg["Team"], "games": pg["G"],
            "three_attempts_per_game": pg["3PA"], "three_pct": pg["3P%"],
            "three_point_attempt_rate": adv["3PAr"],
        })
    if [(row["games"], row["three_attempts_per_game"], row["three_pct"], row["three_point_attempt_rate"]) for row in bam_role] != [("71", "0.6", ".357", ".041"), ("78", "2.8", ".357", ".199"), ("73", "5.5", ".318", ".349")]:
        raise ValueError("Bam role validation anchors changed")
    write_csv("heat-bam-three-point-role.csv", bam_role)

    profiles = []
    for player_id, name, pg_table, adv_table, shooting_table in (
        ("adebaba01", "Bam Adebayo", bam_pg, bam_adv, bam_shooting),
        ("antetgi01", "Giannis Antetokounmpo", giannis_pg, giannis_adv, giannis_shooting),
    ):
        pg, adv, shooting = pg_table["2025-26"], adv_table["2025-26"], shooting_table["2025-26"]
        within_three = shooting["% of FGA by Distance::0-3"]
        threes = shooting["% of FGA by Distance::3P"]
        profiles.append({
            "player_id": player_id, "player_name": name, "season": "2025-26", "team": pg["Team"],
            "games": pg["G"], "within_three_share": within_three,
            "other_two_share": f"{1 - float(within_three) - float(threes):.3f}", "three_share": threes,
            "within_three_fg_pct": shooting["FG% by Distance::0-3"], "three_pct": pg["3P%"],
            "true_shooting_pct": adv["TS%"],
        })
    if (profiles[0]["within_three_share"], profiles[0]["three_share"], profiles[1]["within_three_share"], profiles[1]["three_share"], profiles[1]["within_three_fg_pct"], profiles[1]["true_shooting_pct"]) != (".205", ".349", ".610", ".075", ".800", ".658"):
        raise ValueError("Bam/Giannis profile validation anchors changed")
    write_csv("heat-bam-giannis-shot-profiles.csv", profiles)

    mia_pg = by_player(read_flat("MIA_PerGame_2526.csv"), "Miami per-game")
    mia_p100 = by_player(read_flat("MIA_P100P_2526.csv"), "Miami per-100")
    mia_adv = by_player(read_flat("MIA_Adv_2526.csv"), "Miami advanced")
    departure_ids = ("herroty01", "jakucka01", "wareke01", "jaqueja01", "powelno01")
    roles = {
        "herroty01": "Perimeter scoring and shooting", "powelno01": "Perimeter scoring and shooting",
        "jaqueja01": "Secondary creation", "wareke01": "Rebounding, interior size and shooting",
        "jakucka01": "Developing guard creation and shooting", "antetgi01": "High-usage interior scoring and creation",
        "thompkl01": "High-volume three-point shooting",
    }
    matrix = []
    for player_id in departure_ids:
        if any(player_id not in table for table in (mia_pg, mia_p100, mia_adv)):
            raise ValueError(f"Miami join missing {player_id}")
        pg, p100, adv = mia_pg[player_id], mia_p100[player_id], mia_adv[player_id]
        if len({pg["Player"], p100["Player"], adv["Player"]}) != 1 or len({p100["MP"], adv["MP"]}) != 1:
            raise ValueError(f"Miami joined identity or minutes disagree for {player_id}")
        transaction = "Free-agent departure" if player_id == "powelno01" else "Traded to Milwaukee"
        matrix.append({
            "group": "Departure", "player_id": player_id, "player_name": pg["Player"], "team_2025_26": "MIA",
            "transaction": transaction, "games": pg["G"], "minutes_per_game": pg["MP"],
            "total_minutes": adv["MP"], "three_attempts_per_100": p100["3PA"], "three_pct": pg["3P%"],
            "assists_per_100": p100["AST"], "true_shooting_pct": adv["TS%"], "role_note": roles[player_id],
        })
    for player_id, name, pg, p100, adv, transaction in (
        ("antetgi01", "Giannis Antetokounmpo", giannis_pg["2025-26"], giannis_p100["2025-26"], giannis_adv["2025-26"], "Arrived from Milwaukee"),
        ("thompkl01", "Klay Thompson", klay_pg["2025-26"], klay_p100["2025-26"], klay_adv["2025-26"], "Separate addition"),
    ):
        matrix.append({
            "group": "Arrival", "player_id": player_id, "player_name": name, "team_2025_26": pg["Team"],
            "transaction": transaction, "games": pg["G"], "minutes_per_game": pg["MP"],
            "total_minutes": adv["MP"], "three_attempts_per_100": p100["3PA"], "three_pct": pg["3P%"],
            "assists_per_100": p100["AST"], "true_shooting_pct": adv["TS%"], "role_note": roles[player_id],
        })
    departed_minutes = sum(int(mia_adv[player_id]["MP"]) for player_id in departure_ids)
    team_minutes = sum(int(row["MP"]) for row in mia_adv.values())
    if (departed_minutes, team_minutes) != (7520, 19707):
        raise ValueError("Miami player-minute totals changed")
    write_csv("heat-offseason-2025-26.csv", matrix)

    current_p100 = by_player(read_flat("MIA_P100P.csv"), "Miami current per-100")
    on_off = read_flat("MIA_OnOff.csv")
    giannis_on = next(row for row in on_off if row["player_id"] == "antetgi01" and row["split"] == "On Court")
    if (current_p100["antetgi01"]["MP"], giannis_on["minutes"]) != ("157", "158"):
        raise ValueError("Expected Giannis 157/158 minute source discrepancy changed")

    notes = """# Miami Heat preview chart preparation\n\n- Generated by `scripts/prepare_heat_preview.py` from the supplied Basketball-Reference exports in `assets/data/raw`; raw files are unchanged.\n- Career rows are keyed by season after validating one non-aggregate team row per season. Miami tables are joined by stable `Player-additional` Basketball-Reference IDs.\n- Grouped shooting and adjusted-shooting headers are combined with their group labels so duplicate fields such as `2P`, `3P`, `0-3` and assisted-share columns remain distinct. `% of FG Ast'd` is not used as an attempt measure.\n- Per-game `MP` is kept as MPG; advanced/per-100 `MP` is total minutes. Shooting and attempt shares are stored as fractions; advanced `USG%` remains in percentage units. Missing values and Klay's 2019-20/2020-21 absences remain blank, not zero. Lines must not bridge those absences.\n- Completed seasons are separated from the five-game 2026-27 snapshot. The current Miami per-game team export is not supplied, but the Bam and Klay career exports contain their five-game rows.\n- Giannis has 157 minutes in `MIA_P100P.csv` and 158 on-court minutes in `MIA_OnOff.csv`; both source values are preserved and the discrepancy is not reconciled by invention. `MIA_Lineups.csv` contains team-minus-opponent differentials, including shooting percentages, and is not used as lineup shooting accuracy.\n- The five departures logged 7,520 of 19,707 recorded Miami player-minutes in `MIA_Adv_2526.csv` (38.16%, described as approximately 38%). This is rotation usage, not lost wins or forecast replacement minutes. Ware's source row is 9.0 rebounds in 22.1 MPG.\n- No supplied completed-season 2025-26 PerGame, P100P and Adv tables contain Bobby Portis or Tim Hardaway Jr. Their five-game Miami rows are not substituted. Those three 2025-26 table types (with stable player IDs) are required to add each player to the matrix.\n- The source lineup and on/off tables cover five Miami games; they do not supply complete possession-level both/only/neither splits and are not used to claim long-term pair fit.\n- League-relative shooting indices use 100 as league average. No exact league-average percentage is reverse-engineered from rounded indices. Exact 2025-26 three-point makes and attempts are not present in the matrix inputs, so none are reconstructed from rounded per-game or per-100 values.\n"""
    (OUT / "heat-preview-prep.notes.md").write_text(notes, encoding="utf-8")
    print("Validated Miami sources and wrote four chart-ready CSVs plus preparation notes.")


if __name__ == "__main__":
    main()
