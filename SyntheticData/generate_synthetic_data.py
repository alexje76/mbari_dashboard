#!/usr/bin/env python3
"""Generate synthetic minute-resolution wave-energy telemetry.

Outputs:
  data/YYYY-MM-DD.csv       Minute-resolution data
  data/overview.csv         Hourly downsampled data
  data/manifest.json        Date-range metadata
  config/chartTypes.json    Chart catalog
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

MINUTE_FIELDS = [
    "timestamp_ns", "timestamp_iso", "controller", "hs", "tp", "avg_power",
    "power_out", "battery_pct", "sea_state_energy", "efficiency", "peaks",
    "nextwave", "nextwave_error", "nextwave_error_2",
]

OVERVIEW_FIELDS = [
    "timestamp_ns", "timestamp_iso", "controller", "hs", "tp", "avg_power",
    "power_out", "battery_pct", "sea_state_energy", "efficiency", "peaks_total",
    "nextwave", "nextwave_error", "nextwave_error_2",
]

CONTROLLERS = ("free response", "controller 1", "controller 2")
NEXTWAVE_STATES = ("On", "Starting", "Off")

CHART_TYPES_CONFIG = {
    "chartTypes": [
        {"name": "avg_power", "label": "Avg Power", "unit": "W", "category": "power"},
        {"name": "efficiency", "label": "Efficiency", "unit": "%", "category": "power"},
        {"name": "power_out", "label": "Power Out", "unit": "W", "category": "power"},
        {"name": "battery_pct", "label": "Battery %", "unit": "%", "category": "power"},
        {"name": "sea_state_energy", "label": "Sea State Energy", "unit": "J/m²", "category": "wave"},
        {"name": "hs", "label": "Wave Height (Hs)", "unit": "m", "category": "wave"},
        {"name": "tp", "label": "Wave Period (Tp)", "unit": "s", "category": "wave"},
        {"name": "peaks", "label": "Peaks", "unit": "count", "category": "system"},
        {"name": "nextwave", "label": "NextWave State", "unit": "state", "category": "prediction"},
        {"name": "nextwave_error", "label": "NextWave Error", "unit": "RMS", "category": "prediction"},
        {"name": "nextwave_error_2", "label": "NextWave Error 2", "unit": "value", "category": "prediction"},
    ]
}


def ros2_ns(dt: datetime) -> int:
    return int(dt.timestamp() * 1_000_000_000)


def iso_timestamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def battery_series(rng: random.Random, total_minutes: int) -> Iterator[float]:
    battery = rng.uniform(72, 94)
    charging = False
    charge_left = 0
    for minute in range(total_minutes):
        if not charging and minute > 0 and rng.random() < 1 / rng.randint(720, 1200):
            charging, charge_left = True, rng.randint(120, 300)
        if charging:
            battery += rng.uniform(0.025, 0.09)
            charge_left -= 1
            if charge_left <= 0 or battery >= 99.5:
                charging = False
        else:
            battery -= rng.uniform(0.005, 0.035)
        yield round(max(0.0, min(100.0, battery)), 2)


def sea_state_series(rng: random.Random, total_minutes: int) -> Iterator[tuple[float, float]]:
    """Generate slowly drifting, positively skewed sea states.

    Log-space mean reversion gives a long tail for larger waves while the
    small per-minute innovations prevent abrupt, independent jumps.
    """
    log_hs = rng.normalvariate(-0.10, 0.35)
    log_tp = rng.normalvariate(1.75, 0.18)
    for _ in range(total_minutes):
        # Occasional broader weather-system shift, still smoothed over time.
        if rng.random() < 1 / 720:
            log_hs += rng.normalvariate(0.0, 0.35)
            log_tp += rng.normalvariate(0.0, 0.12)

        log_hs += 0.018 * (-0.10 - log_hs) + rng.normalvariate(0.0, 0.025)
        log_tp += 0.012 * (1.75 - log_tp) + rng.normalvariate(0.0, 0.010)
        hs = max(0.05, min(8.0, 2.0 * (2.718281828 ** log_hs)))
        tp = max(2.0, min(18.0, 2.718281828 ** log_tp))
        yield round(hs, 3), round(tp, 3)


def sea_state_energy(hs: float, tp: float, rng: random.Random) -> float:
    return round(0.5 * hs ** 2 * tp * rng.uniform(0.9, 1.1), 2)


def calculate_efficiency(avg_power: float, sea_state_e: float) -> float:
    """Calculate avg_power / sea_state_energy * 100 without clamping."""
    if sea_state_e <= 0:
        return 0.0
    return round((avg_power / sea_state_e) * 100, 2)


def controller_and_power_series(
    rng: random.Random, total_minutes: int
) -> Iterator[tuple[str, float]]:
    """Generate 30-minute-to-24-hour controller blocks and avg power.

    A controller may be selected again at a block boundary. Re-selecting the
    same controller preserves its power level; an actual swap resets it.
    Within a block, each minute changes by at most +/-10% from the prior minute.
    """
    controller = rng.choice(CONTROLLERS)
    minutes_left = 0
    avg_power = rng.uniform(-30.0, 200.0)
    for _ in range(total_minutes):
        if minutes_left <= 0:
            next_controller = rng.choice(CONTROLLERS)
            if next_controller != controller:
                controller = next_controller
                avg_power = rng.uniform(-30.0, 200.0)
            minutes_left = rng.randint(30, 24 * 60)
        elif minutes_left < 24 * 60:
            avg_power *= 1.0 + rng.uniform(-0.10, 0.10)
        yield controller, round(avg_power, 2)
        minutes_left -= 1


def nextwave_state_series(rng: random.Random, total_minutes: int) -> Iterator[tuple[str, float, float]]:
    state = rng.choice(NEXTWAVE_STATES)
    state_left = rng.randint(30, 120)
    error, error_2 = rng.uniform(0, 1500), rng.uniform(0, 1000)
    for _ in range(total_minutes):
        if state_left <= 0:
            state, state_left = rng.choice(NEXTWAVE_STATES), rng.randint(30, 120)
        if rng.random() < 0.05:
            error, error_2 = rng.uniform(500, 1500), rng.uniform(300, 1000)
        else:
            error += rng.uniform(-50, 50)
            error_2 += rng.uniform(-30, 30)
        yield state, round(max(0.0, min(1500.0, error)), 2), round(max(0.0, min(1000.0, error_2)), 2)
        state_left -= 1


def generate_minute_rows(rng: random.Random, start: datetime, total_minutes: int) -> Iterator[dict]:
    sea_states = sea_state_series(rng, total_minutes)
    controllers = controller_and_power_series(rng, total_minutes)
    batteries = battery_series(rng, total_minutes)
    nextwaves = nextwave_state_series(rng, total_minutes)
    for i, ((hs, tp), (controller, avg_power), battery, nextwave) in enumerate(
        zip(sea_states, controllers, batteries, nextwaves)
    ):
        timestamp = start + timedelta(minutes=i)
        nw_state, nw_err, nw_err2 = nextwave
        sse = sea_state_energy(hs, tp, rng)
        yield {
            "timestamp_ns": ros2_ns(timestamp),
            "timestamp_iso": iso_timestamp(timestamp),
            "controller": controller,
            "hs": hs,
            "tp": tp,
            "avg_power": avg_power,
            "power_out": round(rng.uniform(0, 600), 2),
            "battery_pct": battery,
            "sea_state_energy": sse,
            "efficiency": calculate_efficiency(avg_power, sse),
            "peaks": rng.randint(1, 3),
            "nextwave": nw_state,
            "nextwave_error": nw_err,
            "nextwave_error_2": nw_err2,
        }


def downsample_to_hourly(minute_rows: list[dict]) -> list[dict]:
    hourly_rows = []
    for start in range(0, len(minute_rows), 60):
        bucket = minute_rows[start:start + 60]
        if len(bucket) < 60:
            break
        first = bucket[0]
        avg = lambda key, nd: round(sum(row[key] for row in bucket) / len(bucket), nd)
        hourly_rows.append({
            "timestamp_ns": first["timestamp_ns"],
            "timestamp_iso": first["timestamp_iso"],
            "controller": first["controller"],
            "hs": avg("hs", 3), "tp": avg("tp", 3),
            "avg_power": avg("avg_power", 2),
            "power_out": avg("power_out", 2),
            "battery_pct": avg("battery_pct", 2),
            "sea_state_energy": avg("sea_state_energy", 2),
            "efficiency": avg("efficiency", 2),
            "peaks_total": sum(row["peaks"] for row in bucket),
            "nextwave": bucket[-1]["nextwave"],
            "nextwave_error": avg("nextwave_error", 2),
            "nextwave_error_2": avg("nextwave_error_2", 2),
        })
    return hourly_rows


def generate_all_data(args) -> tuple[dict[str, list[dict]], list[dict], dict]:
    rng = random.Random(args.seed)
    total_minutes = args.days * 24 * 60
    start = datetime.fromisoformat(args.start.replace("Z", "+00:00"))
    all_rows = list(generate_minute_rows(rng, start, total_minutes))
    daily_data = {}
    for row in all_rows:
        daily_data.setdefault(row["timestamp_iso"][:10], []).append(row)
    overview = downsample_to_hourly(all_rows)
    return daily_data, overview, {
        "availableDateRange": {
            "minDate": all_rows[0]["timestamp_iso"],
            "maxDate": all_rows[-1]["timestamp_iso"],
        },
        "dayFiles": sorted(daily_data),
        "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def write_csv(filepath: Path, fieldnames: list[str], rows: list[dict]):
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with filepath.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"✓ Wrote {len(rows):,} rows to {filepath}")


def write_json(filepath: Path, data: dict):
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with filepath.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"✓ Wrote {filepath}")


def main(args):
    print(f"Generating {args.days} days of synthetic telemetry (seed={args.seed})...")
    daily_data, overview, manifest = generate_all_data(args)
    root = Path(args.output)
    for date, rows in sorted(daily_data.items()):
        write_csv(root / "data" / f"{date}.csv", MINUTE_FIELDS, rows)
    write_csv(root / "data" / "overview.csv", OVERVIEW_FIELDS, overview)
    write_json(root / "data" / "manifest.json", manifest)
    write_json(root / "config" / "chartTypes.json", CHART_TYPES_CONFIG)
    print("\n✓ Data generation complete!")
    print(f"  Total day files: {len(daily_data)}")
    print(f"  Total minute records: {sum(map(len, daily_data.values())):,}")
    print(f"  Total hourly records: {len(overview):,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate synthetic wave-energy telemetry")
    parser.add_argument("--start", default="2026-10-05T00:00:00Z", help="UTC start time")
    parser.add_argument("--days", type=int, default=60, help="Number of days")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--output", default="./data_output", help="Output directory root")
    main(parser.parse_args())
