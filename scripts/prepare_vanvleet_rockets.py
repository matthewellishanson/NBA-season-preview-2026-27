#!/usr/bin/env python3
"""Validate the supplied VanVleet/Rockets on-off transcription and prepare chart data."""

from __future__ import annotations

import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW_PATH = ROOT / "assets" / "data" / "raw" / "VanVleet_Rockets_OnOff.csv"
OUTPUT_PATH = ROOT / "assets" / "data" / "processed" / "vanvleet-rockets-on-off.csv"

SOURCE_FIELDS = (
    "season", "split", "minutes", "team_ortg", "team_tov_pct",
    "opponent_ortg", "team_efg_pct",
)
OUTPUT_FIELDS = SOURCE_FIELDS + (
    "comparison_status", "chart_included", "ortg_on_minus_off",
    "tov_on_minus_off_pp", "source_file", "source_row", "source_provenance",
)
EXPECTED_KEYS = (
    ("2023-24", "on"), ("2023-24", "off"),
    ("2024-25", "on"), ("2024-25", "off"),
    ("2025-26", "team_full_season"),
    ("2026-27", "on"), ("2026-27", "off"),
)
EXPECTED_VALUES = {
    ("2023-24", "on"): ("2686", "116.4", "12.4", "113.4", "53.7"),
    ("2023-24", "off"): ("1288", "112.1", "13.6", "114.6", "51.3"),
    ("2024-25", "on"): ("2114", "116.5", "12.6", "110.8", "51.7"),
    ("2024-25", "off"): ("1845", "114.9", "15.6", "112.3", "52.9"),
    ("2025-26", "team_full_season"): ("", "118.6", "13.3", "113.2", "54.2"),
    ("2026-27", "on"): ("61", "127.0", "14.8", "109.2", "60.0"),
    ("2026-27", "off"): ("83", "122.4", "17.1", "114.0", "56.7"),
}


def number(value: str, location: str, *, allow_blank: bool = False) -> Decimal | None:
    value = value.strip()
    if not value:
        if allow_blank:
            return None
        raise ValueError(f"{location}: missing numeric value")
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise ValueError(f"{location}: invalid numeric value {value!r}") from error
    if not parsed.is_finite():
        raise ValueError(f"{location}: non-finite numeric value {value!r}")
    return parsed


def one_decimal(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.1")), "f")


def read_source() -> list[dict[str, str]]:
    with RAW_PATH.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != SOURCE_FIELDS:
            raise ValueError(
                f"{RAW_PATH.name}: expected columns {SOURCE_FIELDS}, found {reader.fieldnames}"
            )
        rows = []
        for source_row, raw in enumerate(reader, start=2):
            row = {field: (raw.get(field) or "").strip() for field in SOURCE_FIELDS}
            key = (row["season"], row["split"])
            if key not in EXPECTED_VALUES:
                raise ValueError(f"{RAW_PATH.name}:{source_row}: unexpected season/split {key}")
            supplied = tuple(row[field] for field in SOURCE_FIELDS[2:])
            if supplied != EXPECTED_VALUES[key]:
                raise ValueError(
                    f"{RAW_PATH.name}:{source_row}: supplied values changed for {key}; "
                    f"expected {EXPECTED_VALUES[key]}, found {supplied}"
                )
            number(row["minutes"], f"{key} minutes", allow_blank=key == ("2025-26", "team_full_season"))
            for field in ("team_ortg", "team_tov_pct", "opponent_ortg", "team_efg_pct"):
                number(row[field], f"{key} {field}")
            row["_source_row"] = str(source_row)
            rows.append(row)

    keys = tuple((row["season"], row["split"]) for row in rows)
    if keys != EXPECTED_KEYS:
        raise ValueError(f"{RAW_PATH.name}: expected rows {EXPECTED_KEYS}, found {keys}")
    if rows[4]["minutes"] != "":
        raise ValueError("2025-26 full-season minutes must remain blank, not zero")
    return rows


def build_rows(source_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    pairs: dict[str, dict[str, dict[str, str]]] = {}
    for row in source_rows:
        if row["split"] in {"on", "off"}:
            pairs.setdefault(row["season"], {})[row["split"]] = row

    for season in ("2023-24", "2024-25", "2026-27"):
        if set(pairs.get(season, {})) != {"on", "off"}:
            raise ValueError(f"{season}: expected exactly one on row and one off row")

    differences = {}
    for season, pair in pairs.items():
        on = pair["on"]
        off = pair["off"]
        differences[season] = (
            one_decimal(Decimal(on["team_ortg"]) - Decimal(off["team_ortg"])),
            one_decimal(Decimal(on["team_tov_pct"]) - Decimal(off["team_tov_pct"])),
        )

    if differences["2023-24"] != ("4.3", "-1.2"):
        raise ValueError("2023-24 displayed on/off differences are not +4.3 ORtg and -1.2 TOV percentage points")
    if differences["2024-25"] != ("1.6", "-3.0"):
        raise ValueError("2024-25 displayed on/off differences are not +1.6 ORtg and -3.0 TOV percentage points")

    output = []
    for source in source_rows:
        season = source["season"]
        if season in {"2023-24", "2024-25"}:
            status = "completed_on_off_comparison"
            included = "true"
        elif season == "2025-26":
            status = "full_team_season_vanvleet_did_not_play"
            included = "true"
        else:
            status = "incomplete_small_sample_future_use"
            included = "false"
        gap = differences.get(season, ("", ""))
        output.append({
            **{field: source[field] for field in SOURCE_FIELDS},
            "comparison_status": status,
            "chart_included": included,
            "ortg_on_minus_off": gap[0],
            "tov_on_minus_off_pp": gap[1],
            "source_file": RAW_PATH.name,
            "source_row": source["_source_row"],
            "source_provenance": "Basketball Reference team on/off tables, manually transcribed by the author",
        })
    return output


def main() -> None:
    rows = build_rows(read_source())
    if len([row for row in rows if row["chart_included"] == "true"]) != 5:
        raise ValueError("Chart output must contain four completed-season split rows and one full-season context row")
    if len([row for row in rows if row["season"] == "2026-27"]) != 2:
        raise ValueError("Both 2026-27 rows must remain in cleaned data")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(
        "Validated 7 source rows; wrote 4 completed-season split rows, "
        "1 full-season context row and 2 excluded 2026-27 small-sample rows."
    )


if __name__ == "__main__":
    main()
