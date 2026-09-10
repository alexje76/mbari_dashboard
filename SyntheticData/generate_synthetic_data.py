#c
#!/usr/bin/env python3
"""Generate synthetic minute-resolution ROS 2 telemetry with complete data pipeline.

Generates:
  - Daily CSV files: /data/YYYY-MM-DD.csv (1-minute resolution)
  - Overview CSV: /data/overview.csv (hourly downsampled)
  - Manifest JSON: /data/manifest.json
  - Chart types config: /config/chartTypes.json

Usage:
  python generate_telemetry.py \\
    --start "2026-10-05T00:00:00Z" \\
    --days 60 \\
    --seed 42 \\
    --output ./data_output
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import random
from typing import Generator, Iterator


# CSV Fields (updated schema)
MINUTE_FIELDS = [
    "timestamp_ns",
    "timestamp_iso",
    "controller",
    "hs",
    "tp",
    "avg_power",
    "power_in",
    "power_out",
    "battery_pct",
    "sea_state_energy",
    "efficiency",
    "peaks",
    "nextwave",
    "nextwave_error",
    "nextwave_error_2",
]

OVERVIEW_FIELDS = [
    "timestamp_ns",
    "timestamp_iso",
    "controller",
    "hs",
    "tp",
    "avg_power",
    "power_in",
    "power_out",
    "battery_pct",
    "sea_state_energy",
    "efficiency",
    "peaks_total",
    "nextwave",
    "nextwave_error",
    "nextwave_error_2",
]

CONTROLLERS = ("free response", "controller 1", "controller 2")
NEXTWAVE_STATES = ("On", "Starting", "Off")

# Chart types catalog
CHART_TYPES_CONFIG = {
    "chartTypes": [
        {"name": "avg_power", "label": "Avg Power", "unit": "W", "category": "power"},
        {"name": "efficiency", "label": "Efficiency", "unit": "%", "category": "power"},
        {"name": "power_in", "label": "Power In", "unit": "W", "category": "power"},
        {"name": "power_out", "label": "Power Out", "unit": "W", "category": "power"},
        {"name": "battery_pct", "label": "Battery %", "unit": "%", "category": "power"},
        {"name": "sea_state_energy", "label": "Sea State Energy", "unit": "J/m²", "category": "wave"},
        {"name": "hs", "label": "Wave Height (Hs)", "unit": "m", "category": "wave"},
        {"name": "tp", "label": "Wave Period (Tp)", "unit": "s", "category": "wave"},
        {"name": "peaks", "label": "Peaks", "unit": "count", "category": "system"},
        {"name": "nextwave", "label": "NextWave State", "unit": "state", "category": "prediction"},
        {"name": "nextwave_error", "label": "NextWave Error", "unit": "RMS", "category": "prediction"},
        {"name": "nextwave_error_2", "label": "NextWave Error 2", "unit": "value", "category": "prediction"}
    ]
}


def ros2_ns(dt: datetime) -> int:
    """ROS 2 system-clock representation: Unix epoch nanoseconds."""
    return int(dt.timestamp() * 1_000_000_000)


def iso_timestamp(dt: datetime) -> str:
    """Format datetime as ISO 8601 string."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def piecewise_value(
    rng: random.Random,
    low: float,
    high: float,
    block_minutes: int,
    total_minutes: int,
    decimals: int,
) -> Iterator[float]:
    """Keep a value stable for blocks, with small variation inside each block."""
    value = rng.uniform(low, high)
    for minute in range(total_minutes):
        if minute % block_minutes == 0:
            value = rng.uniform(low, high)
        jitter = rng.uniform(-0.03, 0.03) * (high - low)
        yield round(max(low, min(high, value + jitter)), decimals)


def battery_series(rng: random.Random, total_minutes: int) -> Iterator[float]:
    """Smooth linear discharge with periodic linear charging cycles."""
    battery = rng.uniform(72, 94)
    charging = False
    charge_left = 0
    for minute in range(total_minutes):
        # Start a charging cycle every 12-20 hours, lasting 2-5 hours.
        if not charging and minute > 0 and rng.random() < 1 / rng.randint(720, 1200):
            charging = True
            charge_left = rng.randint(120, 300)
        if charging:
            battery += rng.uniform(0.025, 0.09)
            charge_left -= 1
            if charge_left <= 0 or battery >= 99.5:
                charging = False
        else:
            battery -= rng.uniform(0.005, 0.035)
        battery = max(0.0, min(100.0, battery))
        yield round(battery, 2)


def sea_state_energy(hs: float, tp: float, rng: random.Random) -> float:
    """Calculate sea state energy density (J/m²).
    
    Formula: E ≈ 0.5 × Hs² × Tp with random variation (0.9–1.1).
    """
    base_energy = 0.5 * (hs ** 2) * tp
    variation = rng.uniform(0.9, 1.1)
    return round(base_energy * variation, 2)


def calculate_efficiency(power_out: float, sea_state_e: float) -> float:
    """Calculate efficiency as (power_out / sea_state_energy) × 100, clamped [0, 100]."""
    if sea_state_e <= 0:
        return 0.0
    eff = (power_out / sea_state_e) * 100
    return round(min(100.0, max(0.0, eff)), 2)


def nextwave_state_series(
    rng: random.Random, total_minutes: int
) -> Iterator[tuple[str, float, float]]:
    """Generate nextwave state with smooth error variation.
    
    Yields: (state, error, error_2) tuples.
    """
    state = rng.choice(NEXTWAVE_STATES)
    state_duration = rng.randint(30, 120)
    state_minutes_left = state_duration
    error = rng.uniform(0, 1500)
    error_2 = rng.uniform(0, 1000)

    for minute in range(total_minutes):
        # Switch state if duration exhausted
        if state_minutes_left <= 0:
            state = rng.choice(NEXTWAVE_STATES)
            state_duration = rng.randint(30, 120)
            state_minutes_left = state_duration

        # Smooth error variation with occasional spikes
        if rng.random() < 0.05:  # 5% chance of spike
            error = rng.uniform(500, 1500)
            error_2 = rng.uniform(300, 1000)
        else:
            error += rng.uniform(-50, 50)
            error_2 += rng.uniform(-30, 30)

        error = round(max(0.0, min(1500.0, error)), 2)
        error_2 = round(max(0.0, min(1000.0, error_2)), 2)

        yield (state, error, error_2)
        state_minutes_left -= 1


def generate_minute_rows(
    rng: random.Random, start: datetime, total_minutes: int
) -> Iterator[dict]:
    """Generate minute-resolution telemetry rows."""
    hs_vals = piecewise_value(rng, 0, 3, 30, total_minutes, 3)
    tp_vals = piecewise_value(rng, 1, 14, 30, total_minutes, 3)
    battery_vals = battery_series(rng, total_minutes)
    nw_series = nextwave_state_series(rng, total_minutes)

    for i, (hs, tp, battery, (nw_state, nw_err, nw_err2)) in enumerate(
        zip(hs_vals, tp_vals, battery_vals, nw_series)
    ):
        timestamp = start + timedelta(minutes=i)
        controller = rng.choice(CONTROLLERS)
        avg_power = round(rng.uniform(-30, 200), 2)
        power_in = round(rng.uniform(0, 450), 2)
        power_out = round(rng.uniform(0, 600), 2)
        peaks = rng.randint(1, 3)
        
        # Calculate derived fields
        sse = sea_state_energy(hs, tp, rng)
        eff = calculate_efficiency(power_out, sse)

        yield {
            "timestamp_ns": ros2_ns(timestamp),
            "timestamp_iso": iso_timestamp(timestamp),
            "controller": controller,
            "hs": hs,
            "tp": tp,
            "avg_power": avg_power,
            "power_in": power_in,
            "power_out": power_out,
            "battery_pct": battery,
            "sea_state_energy": sse,
            "efficiency": eff,
            "peaks": peaks,
            "nextwave": nw_state,
            "nextwave_error": nw_err,
            "nextwave_error_2": nw_err2,
        }


def downsample_to_hourly(minute_rows: list[dict]) -> list[dict]:
    """Downsample minute-resolution rows to hourly (1 per hour, averaged/summed)."""
    if not minute_rows:
        return []

    hourly_rows = []
    bucket = []

    for row in minute_rows:
        bucket.append(row)
        # Check if next row is in a different hour
        current_hour = datetime.fromisoformat(
            row["timestamp_iso"].replace("Z", "+00:00")
        ).replace(minute=0, second=0, microsecond=0)

        if len(bucket) == 60:  # 60 minutes
            # Aggregate bucket
            first_row = bucket[0]
            agg_row = {
                "timestamp_ns": first_row["timestamp_ns"],
                "timestamp_iso": first_row["timestamp_iso"],
                "controller": first_row["controller"],  # Use first controller in hour
                "hs": round(sum(r["hs"] for r in bucket) / len(bucket), 3),
                "tp": round(sum(r["tp"] for r in bucket) / len(bucket), 3),
                "avg_power": round(sum(r["avg_power"] for r in bucket) / len(bucket), 2),
                "power_in": round(sum(r["power_in"] for r in bucket) / len(bucket), 2),
                "power_out": round(sum(r["power_out"] for r in bucket) / len(bucket), 2),
                "battery_pct": round(sum(r["battery_pct"] for r in bucket) / len(bucket), 2),
                "sea_state_energy": round(sum(r["sea_state_energy"] for r in bucket) / len(bucket), 2),
                "efficiency": round(sum(r["efficiency"] for r in bucket) / len(bucket), 2),
                "peaks_total": sum(r["peaks"] for r in bucket),
                "nextwave": bucket[-1]["nextwave"],  # Use last state in hour
                "nextwave_error": round(sum(r["nextwave_error"] for r in bucket) / len(bucket), 2),
                "nextwave_error_2": round(sum(r["nextwave_error_2"] for r in bucket) / len(bucket), 2),
            }
            hourly_rows.append(agg_row)
            bucket = []

    return hourly_rows


def generate_all_data(args) -> tuple[dict[str, list[dict]], list[dict], dict]:
    """Generate all telemetry data.
    
    Returns:
      (daily_data_dict, overview_data, date_range_info)
    """
    rng = random.Random(args.seed)
    total_minutes = args.days * 24 * 60
    start = datetime.fromisoformat(args.start.replace("Z", "+00:00"))

    # Generate all minute-resolution data
    all_minute_rows = list(generate_minute_rows(rng, start, total_minutes))

    # Split by day for daily files
    daily_data = {}
    current_date = None
    current_day_rows = []

    for row in all_minute_rows:
        row_date = row["timestamp_iso"][:10]
        if row_date != current_date:
            if current_date and current_day_rows:
                daily_data[current_date] = current_day_rows
            current_date = row_date
            current_day_rows = []
        current_day_rows.append(row)

    if current_date and current_day_rows:
        daily_data[current_date] = current_day_rows

    # Generate overview (hourly downsampled)
    overview_data = downsample_to_hourly(all_minute_rows)

    # Build date range info
    first_row = all_minute_rows[0]
    last_row = all_minute_rows[-1]
    start_iso = first_row["timestamp_iso"]
    end_iso = last_row["timestamp_iso"]
    day_files = sorted(daily_data.keys())

    date_range_info = {
        "availableDateRange": {
            "startDate": start_iso,
            "endDate": end_iso,
        },
        "dayFiles": day_files,
        "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    return daily_data, overview_data, date_range_info


def write_csv(filepath: Path, fieldnames: list[str], rows: list[dict]):
    """Write CSV file."""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"✓ Wrote {len(rows):,} rows to {filepath}")


def write_json(filepath: Path, data: dict):
    """Write JSON file."""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"✓ Wrote {filepath}")


def main(args):
    """Generate and write all pipeline data."""
    print(f"Generating {args.days} days of synthetic telemetry (seed={args.seed})...")

    daily_data, overview_data, date_range_info = generate_all_data(args)

    # Setup output directory
    output_root = Path(args.output)
    data_dir = output_root / "data"
    config_dir = output_root / "config"

    # Write daily CSV files
    print("\nWriting daily CSV files...")
    for date, rows in sorted(daily_data.items()):
        write_csv(data_dir / f"{date}.csv", MINUTE_FIELDS, rows)

    # Write overview CSV (hourly)
    print("\nWriting overview CSV...")
    write_csv(data_dir / "overview.csv", OVERVIEW_FIELDS, overview_data)

    # Write manifest JSON
    print("\nWriting manifest...")
    write_json(data_dir / "manifest.json", date_range_info)

    # Write chart types config
    print("\nWriting chart types config...")
    write_json(config_dir / "chartTypes.json", CHART_TYPES_CONFIG)

    print("\n✓ Data generation complete!")
    print(f"  Total day files: {len(daily_data)}")
    print(f"  Total minute records: {sum(len(rows) for rows in daily_data.values()):,}")
    print(f"  Total hourly records: {len(overview_data):,}")
    print(f"  Date range: {date_range_info['availableDateRange']['startDate']} to {date_range_info['availableDateRange']['endDate']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate synthetic buoy telemetry data pipeline"
    )
    parser.add_argument(
        "--start",
        default="2026-10-05T00:00:00Z",
        help="UTC start time (ISO 8601; default: 2026-10-05T00:00:00Z)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=60,
        help="Number of days to generate (default: 60)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    parser.add_argument(
        "--output",
        default="./data_output",
        help="Output directory root (default: ./data_output)",
    )
    args = parser.parse_args()
    main(args)
