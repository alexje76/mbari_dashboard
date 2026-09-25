#!/usr/bin/env python3
"""Build synthetic-dashboard-compatible files from raw CSV inputs.

Input CSVs are discovered recursively. Telemetry is kept in source rows (it is
not merged by Source ID); analytics are calculated only from rows containing
the required signal. Controller logs are joined by wall-clock epoch time.

The wave and NextWave loaders are intentionally no-ops until their schemas are
available. Replace those two functions without changing the aggregation code.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

MINUTE_FIELDS = [
    "timestamp_ns", "timestamp_iso", "controller", "hs", "tp", "avg_power",
    "power_in", "power_to_controller", "battery_voltage", "battery_pct",
    "sea_state_energy", "efficiency", "peaks", "nextwave", "nextwave_error",
    "nextwave_error_2",
]
OVERVIEW_FIELDS = [
    "timestamp_ns", "timestamp_iso", "controller", "hs", "tp", "avg_power",
    "power_in", "power_to_controller", "battery_voltage", "battery_pct",
    "sea_state_energy", "efficiency", "peaks_total", "nextwave",
    "nextwave_error", "nextwave_error_2",
]

TELEMETRY_COLUMNS = {
    "Source ID", "Timestamp (epoch seconds)", "PC Bus Voltage (V)",
    "PC Battery Curr (A)", "PC Load Dump Current (A)", "BC Voltage",
}
CONTROLLER_COLUMNS = {"wall_epoch_seconds", "ros_seconds", "event", "controller"}
CONTROLLER_LABELS = {
    "free_response": "Free Response",
    "stepwise_random_bounded": "Stepwise Random Bounded",
    "stepwise_integrated_bounded": "Stepwise Integrated Bounded",
    # Synthetic variant keys emitted by SyntheticData/generate_synthetic_data.py;
    # keep in sync with its CONTROLLERS constant.
    "synthetic_free_response": "Synthetic Free Response",
    "synthetic_stepwise_random_bounded": "Synthetic Stepwise Random Bounded",
    "synthetic_stepwise_integrated_bounded": "Synthetic Stepwise Integrated Bounded",
}

CHART_TYPES_CONFIG = {
    "chartTypes": [
        {"name": "avg_power", "label": "Avg Power", "unit": "W", "category": "power"},
        {"name": "efficiency", "label": "Efficiency", "unit": "%", "category": "power"},
        {"name": "power_in", "label": "Power In", "unit": "W", "category": "power"},
        {"name": "power_to_controller", "label": "Power to Controller", "unit": "W", "category": "power"},
        {"name": "battery_voltage", "label": "Battery Voltage", "unit": "V", "category": "power"},
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


def warn(message: str) -> None:
    warnings.warn(message, RuntimeWarning, stacklevel=2)


def stripped_header(path: Path) -> list[str]:
    return [str(c).strip() for c in pd.read_csv(path, nrows=0).columns]


def classify(path: Path, columns: set[str]) -> str:
    name = path.name.lower()
    if CONTROLLER_COLUMNS <= columns:
        return "controller"
    if TELEMETRY_COLUMNS <= columns:
        return "telemetry"
    if "nextwave" in name:
        return "nextwave"
    if "wave" in name or "sea_state" in name:
        return "wave"
    return "additional"


def as_number(series: pd.Series, name: str, path: Path) -> pd.Series:
    value = pd.to_numeric(series, errors="coerce")
    nonempty = series.notna() & series.astype(str).str.strip().ne("")
    bad = nonempty & value.isna()
    if bad.any():
        examples = series[bad].astype(str).head(3).tolist()
        raise ValueError(f"Non-numeric values in {name!r} in {path}: {examples}")
    return value


def timestamp_range(path: Path, kind: str) -> tuple[float | None, float | None]:
    columns = stripped_header(path)
    wanted = "Timestamp (epoch seconds)" if kind == "telemetry" else "wall_epoch_seconds"
    if kind == "additional":
        return None, None
    raw = pd.read_csv(path, usecols=[columns[columns.index(wanted)]], low_memory=False, skipinitialspace=True).iloc[:, 0]
    values = pd.to_numeric(raw, errors="coerce").dropna()
    if values.empty:
        raise ValueError(f"No valid {wanted!r} values in {path}")
    return float(values.min()), float(values.max())


def inspect_inputs(root: Path, old_state: dict, output_root: Path) -> tuple[list[dict], set[str]]:
    files: list[dict] = []
    current_paths: set[str] = set()
    input_dirs = [root / "controller_logs", root / "telemetry"]

    for input_dir in input_dirs:
        if not input_dir.is_dir():
            continue
        for path in sorted(input_dir.rglob("*.csv")):
            key = str(path.resolve())
            current_paths.add(key)
            stat = path.stat()
            fingerprint = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
            old = old_state.get("files", {}).get(key)
            if old and old.get("fingerprint") == fingerprint:
                info = {**old, "path": key, "changed": False}
            else:
                columns = set(stripped_header(path))
                kind = classify(path, columns)
                start, end = timestamp_range(path, kind)
                info = {
                    "path": key, "kind": kind, "min": start, "max": end,
                    "fingerprint": fingerprint, "changed": True,
                }
            files.append(info)
    return files, current_paths


def read_telemetry(path: Path, start: float | None = None, end: float | None = None) -> pd.DataFrame:
    original = pd.read_csv(path, nrows=0).columns.tolist()
    names = {str(c).strip(): c for c in original}
    required = TELEMETRY_COLUMNS
    missing = required - set(names)
    if missing:
        raise ValueError(f"Telemetry file {path} is missing columns: {sorted(missing)}")
    use = [names[c] for c in required]
    df = pd.read_csv(path, usecols=use, low_memory=False)
    df.columns = [str(c).strip() for c in df.columns]
    for col in df.columns:
        df[col] = as_number(df[col], col, path)
    ts = df["Timestamp (epoch seconds)"]
    if ts.is_monotonic_decreasing:
        raise ValueError(f"Telemetry timestamps are out of order in {path}")
    if start is not None:
        df = df[ts >= start]
    if end is not None:
        df = df[df["Timestamp (epoch seconds)"] < end]
    return df


def read_controller_logs(paths: list[Path]) -> pd.DataFrame:
    frames = []
    for path in paths:
        df = pd.read_csv(path, low_memory=False)
        df.columns = [str(c).strip() for c in df.columns]
        missing = CONTROLLER_COLUMNS - set(df.columns)
        if missing:
            raise ValueError(f"Controller file {path} is missing columns: {sorted(missing)}")
        for col in ("wall_epoch_seconds", "ros_seconds"):
            df[col] = as_number(df[col], col, path)
        if not df["wall_epoch_seconds"].dropna().is_monotonic_increasing:
            raise ValueError(f"Controller wall timestamps are out of order in {path}")
        df["controller"] = df["controller"].astype("string").str.strip()
        unknown = set(df["controller"].dropna()) - set(CONTROLLER_LABELS)
        if unknown:
            raise ValueError(f"Unknown controller names in {path}: {sorted(unknown)}")
        frames.append(df[["wall_epoch_seconds", "ros_seconds", "event", "controller"]])
    if not frames:
        return pd.DataFrame(columns=["wall_epoch_seconds", "ros_seconds", "event", "controller"])
    events = pd.concat(frames, ignore_index=True).dropna(subset=["wall_epoch_seconds"])
    events = events.sort_values("wall_epoch_seconds", kind="stable").reset_index(drop=True)
    events["controller"] = events["controller"].map(CONTROLLER_LABELS)
    check_ros_clock(events)
    return events


def check_ros_clock(events: pd.DataFrame, tolerance: float = 0.05) -> None:
    valid = events.dropna(subset=["wall_epoch_seconds", "ros_seconds"])
    if len(valid) < 2:
        return
    wall = valid["wall_epoch_seconds"].iloc[-1] - valid["wall_epoch_seconds"].iloc[0]
    ros = valid["ros_seconds"].iloc[-1] - valid["ros_seconds"].iloc[0]
    if wall > 1 and abs(ros / wall - 1) > tolerance:
        warn(f"ROS and wall clocks run at different speeds: wall={wall:.3f}s, ROS={ros:.3f}s")


def check_sample_rate(df: pd.DataFrame) -> None:
    power = df.dropna(subset=[
        "Timestamp (epoch seconds)", "PC Bus Voltage (V)",
        "PC Battery Curr (A)", "PC Load Dump Current (A)",
    ]).sort_values("Timestamp (epoch seconds)")
    if len(power) < 3:
        raise ValueError("Fewer than three complete power samples; cannot verify the assumed 10 Hz rate")
    dt = np.diff(power["Timestamp (epoch seconds)"].to_numpy())
    dt = dt[dt > 0]
    if not len(dt) or not np.isclose(np.median(dt), 0.1, atol=0.02):
        raise ValueError(f"Telemetry is not approximately 10 Hz; median sample interval is {np.median(dt):.6g}s")


# Piecewise-linear open-circuit voltage -> state-of-charge curve for the
# 24-battery lead-acid bank (24 x 12 V, 6 x 2 V cells each), ~288 V nominal.
# Anchored to observed BC Voltage readings: ~290 V depleted through ~325 V
# float charge. Swappable: replace targets below with the exact charge curve
# when it arrives.
LEAD_ACID_BANK_SOC_CURVE = (
    (288.0, 0.0),
    (294.0, 10.0),
    (299.0, 20.0),
    (303.0, 30.0),
    (306.0, 40.0),
    (309.0, 50.0),
    (313.0, 60.0),
    (317.0, 70.0),
    (321.0, 80.0),
    (323.5, 90.0),
    (325.0, 100.0),
)


def voltage_to_percent(voltage: float | pd.Series, curve=LEAD_ACID_BANK_SOC_CURVE):
    """Swappable voltage-to-charge lookup for the 288 V lead-acid bank.

    Piecewise-linear interpolation over the lead-acid open-circuit curve.
    Implausible readings outside the curve span (e.g. transient spikes) map to
    NaN rather than clamping to 0/100. Replace ``curve`` to swap in the exact
    charge curve.
    """
    voltages = np.asarray([point[0] for point in curve])
    percents = np.asarray([point[1] for point in curve])
    voltage = np.asarray(voltage)
    return np.where(
        (voltage < voltages[0]) | (voltage > voltages[-1]),
        np.nan,
        np.interp(voltage, voltages, percents),
    )


def load_wave_data(paths: list[Path], start: float | None = None, end: float | None = None) -> pd.DataFrame:
    """Hook for processed Hs/Tp/sea-state/peaks CSVs; intentionally empty for now."""
    return pd.DataFrame(columns=["_minute", "hs", "tp", "sea_state_energy", "peaks"])


def load_nextwave_data(paths: list[Path], start: float | None = None, end: float | None = None) -> pd.DataFrame:
    """Hook for unprocessed NextWave CSVs; intentionally empty for now."""
    return pd.DataFrame(columns=["_minute", "nextwave", "nextwave_error", "nextwave_error_2"])


def combine_states(values: list[str]) -> str:
    values = [v for v in values if pd.notna(v) and str(v) != ""]
    return "Undefined" if not values else values[0] if len(set(values)) == 1 else "Mixed"


def controller_by_minute(minutes: pd.DatetimeIndex, events: pd.DataFrame) -> pd.Series:
    if events.empty:
        return pd.Series("Undefined", index=minutes, dtype="string")
    times = events["wall_epoch_seconds"].to_numpy()
    labels = events["controller"].to_numpy()
    result = []
    for minute in minutes:
        start = minute.value / 1e9
        end = start + 60
        left = np.searchsorted(times, start, side="right")
        right = np.searchsorted(times, end, side="left")
        states = []
        if left:
            states.append(labels[left - 1])
        else:
            states.append("Undefined")
        states.extend(labels[left:right].tolist())
        result.append(combine_states(states))
    return pd.Series(result, index=minutes, dtype="string")


def build_minute_rows(raw: pd.DataFrame, events: pd.DataFrame, wave: pd.DataFrame, nextwave: pd.DataFrame) -> pd.DataFrame:
    check_sample_rate(raw)
    raw = raw.copy()
    raw["_minute"] = pd.to_datetime(raw["Timestamp (epoch seconds)"], unit="s", utc=True).dt.floor("min")
    raw["_power"] = raw["PC Bus Voltage (V)"] * (raw["PC Battery Curr (A)"] + raw["PC Load Dump Current (A)"])
    raw["_battery_pct"] = voltage_to_percent(raw["BC Voltage"])
    grouped = raw.groupby("_minute", sort=True)
    rows = []
    for minute, group in grouped:
        # Complete-minute filtering occurs after aggregation, using observed samples.
        if group["Timestamp (epoch seconds)"].min() > minute.value / 1e9 + 0.02:
            continue
        if group["Timestamp (epoch seconds)"].max() < minute.value / 1e9 + 59.8:
            continue
        ns = int(minute.value)
        avg_power = group["_power"].mean()
        battery_voltage = group["BC Voltage"].mean()
        battery = group["_battery_pct"].mean()
        rows.append({
            "timestamp_ns": ns,
            "timestamp_iso": minute.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "controller": None,
            "hs": np.nan, "tp": np.nan,
            "avg_power": avg_power,
            "power_in": max(avg_power, 0.0),
            "power_to_controller": abs(min(avg_power, 0.0)),
            "battery_voltage": battery_voltage,
            "battery_pct": battery,
            "sea_state_energy": np.nan,
            "efficiency": np.nan,
            "peaks": np.nan,
            "nextwave": None, "nextwave_error": np.nan, "nextwave_error_2": np.nan,
            "_minute": minute,
        })
    result = pd.DataFrame(rows)
    if result.empty:
        return result
    result["controller"] = controller_by_minute(pd.DatetimeIndex(result["_minute"]), events).to_numpy()
    if not wave.empty:
        result = result.merge(wave, on="_minute", how="left", suffixes=("", "_wave"))
        for col in ("hs", "tp", "sea_state_energy", "peaks"):
            result[col] = result[col].fillna(result.get(f"{col}_wave"))
            result.drop(columns=[f"{col}_wave"], errors="ignore", inplace=True)
    if not nextwave.empty:
        result = result.merge(nextwave, on="_minute", how="left", suffixes=("", "_nextwave"))
        for col in ("nextwave", "nextwave_error", "nextwave_error_2"):
            result[col] = result[col].fillna(result.get(f"{col}_nextwave"))
            result.drop(columns=[f"{col}_nextwave"], errors="ignore", inplace=True)
    result["efficiency"] = np.where(
        pd.to_numeric(result["sea_state_energy"], errors="coerce") > 0,
        result["avg_power"] / result["sea_state_energy"] * 100,
        np.nan,
    )
    return result.drop(columns=["_minute"])


def round_output(df: pd.DataFrame, fields: list[str]) -> pd.DataFrame:
    df = df.copy()
    for col in fields:
        if col not in df:
            df[col] = np.nan
    numeric = [c for c in fields if c not in {"timestamp_ns", "timestamp_iso", "controller", "nextwave"}]
    for col in numeric:
        df[col] = pd.to_numeric(df[col], errors="coerce").round(2)
    df["timestamp_ns"] = pd.to_numeric(df["timestamp_ns"], errors="raise").astype("int64")
    return df[fields].sort_values("timestamp_ns").drop_duplicates("timestamp_ns", keep="last")


def hourly_from_minutes(minutes: pd.DataFrame) -> pd.DataFrame:
    if minutes.empty:
        return pd.DataFrame(columns=OVERVIEW_FIELDS)
    df = minutes.copy()
    df["_time"] = pd.to_datetime(df["timestamp_ns"], unit="ns", utc=True)
    df["_hour"] = df["_time"].dt.floor("h")
    rows = []
    for hour, group in df.groupby("_hour", sort=True):
        times = group["_time"].sort_values()
        expected = pd.date_range(hour, periods=60, freq="min", tz="UTC")
        if len(group) != 60 or not times.reset_index(drop=True).equals(expected.to_series().reset_index(drop=True)):
            continue
        rows.append({
            "timestamp_ns": int(hour.value),
            "timestamp_iso": hour.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "controller": combine_states(group["controller"].tolist()),
            "hs": group["hs"].mean(), "tp": group["tp"].mean(),
            "avg_power": group["avg_power"].mean(), "power_in": group["power_in"].mean(),
            "power_to_controller": group["power_to_controller"].mean(),
            "battery_voltage": group["battery_voltage"].mean(),
            "battery_pct": group["battery_pct"].mean(),
            "sea_state_energy": group["sea_state_energy"].mean(),
            "efficiency": group["efficiency"].mean(),
            "peaks_total": group["peaks"].mean(),
            "nextwave": combine_states(group["nextwave"].tolist()),
            "nextwave_error": group["nextwave_error"].mean(),
            "nextwave_error_2": group["nextwave_error_2"].mean(),
        })
    return round_output(pd.DataFrame(rows), OVERVIEW_FIELDS)


def read_dashboard_csv(path: Path, fields: list[str]) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=fields)
    df = pd.read_csv(path)
    return round_output(df, fields)


def csv_text(df: pd.DataFrame, fields: list[str]) -> str:
    return round_output(df, fields).to_csv(index=False, na_rep="")


def write_if_changed(path: Path, text: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def merge_daily(output_data: Path, new_rows: pd.DataFrame, start: float, end: float) -> set[str]:
    affected = set()
    start_ts = pd.Timestamp.fromtimestamp(start, tz="UTC")
    end_ts = pd.Timestamp.fromtimestamp(end, tz="UTC")
    day = start_ts.normalize()
    while day < end_ts:
        date = day.strftime("%Y-%m-%d")
        path = output_data / f"{date}.csv"
        old = read_dashboard_csv(path, MINUTE_FIELDS)
        old_time = pd.to_datetime(old["timestamp_ns"], unit="ns", utc=True) if not old.empty else pd.Series(dtype="datetime64[ns, UTC]")
        keep = old[(old_time < start_ts) | (old_time >= end_ts)] if not old.empty else old
        add = new_rows[pd.to_datetime(new_rows["timestamp_ns"], unit="ns", utc=True).dt.strftime("%Y-%m-%d") == date]
        merged = pd.concat([keep, add[MINUTE_FIELDS]], ignore_index=True)
        if merged.empty:
            if path.exists():
                path.unlink()
                affected.add(date)
        elif write_if_changed(path, csv_text(merged, MINUTE_FIELDS)):
            affected.add(date)
        day += pd.Timedelta(days=1)
    return affected


def rebuild_overview(output_data: Path, start: float, end: float) -> None:
    overview_path = output_data / "overview.csv"
    old = read_dashboard_csv(overview_path, OVERVIEW_FIELDS)
    start_hour = pd.Timestamp.fromtimestamp(start, tz="UTC").floor("h")
    end_hour = pd.Timestamp.fromtimestamp(end - 1e-6, tz="UTC").floor("h") + pd.Timedelta(hours=1)
    if not old.empty:
        old_time = pd.to_datetime(old["timestamp_ns"], unit="ns", utc=True)
        old = old[(old_time < start_hour) | (old_time >= end_hour)]
    day = start_hour.normalize()
    parts = []
    while day < end_hour:
        path = output_data / f"{day.strftime('%Y-%m-%d')}.csv"
        if path.exists():
            parts.append(read_dashboard_csv(path, MINUTE_FIELDS))
        day += pd.Timedelta(days=1)
    new = hourly_from_minutes(pd.concat(parts, ignore_index=True) if parts else pd.DataFrame())
    if not new.empty:
        times = pd.to_datetime(new["timestamp_ns"], unit="ns", utc=True)
        new = new[(times >= start_hour) & (times < end_hour)]
    write_if_changed(overview_path, csv_text(pd.concat([old, new], ignore_index=True), OVERVIEW_FIELDS))


def initialize_static_files(output_root: Path) -> None:
    config = output_root / "config" / "chartTypes.json"
    if not config.exists():
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(json.dumps(CHART_TYPES_CONFIG, indent=2) + "\n", encoding="utf-8")


def update_manifest(output_root: Path) -> None:
    path = output_root / "data" / "manifest.json"
    if path.exists():
        return
    files = sorted((output_root / "data").glob("20??-??-??.csv"))
    rows = [pd.read_csv(p, usecols=["timestamp_iso"]) for p in files]
    if rows:
        stamps = pd.concat(rows)["timestamp_iso"]
        available = {"minDate": stamps.min(), "maxDate": stamps.max()}
    else:
        available = {"minDate": None, "maxDate": None}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"availableDateRange": available, "dayFiles": [p.stem for p in files], "lastUpdated": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")}, indent=2) + "\n", encoding="utf-8")


def build(input_root: Path, output_root: Path) -> None:
    output_root.mkdir(parents=True, exist_ok=True)
    state_path = output_root / ".dashboard_state.json"
    old_state = json.loads(state_path.read_text()) if state_path.exists() else {}
    infos, current_paths = inspect_inputs(input_root, old_state, output_root)
    old_files = old_state.get("files", {})
    changed = [x for x in infos if x["changed"]]
    removed = [x for key, x in old_files.items() if key not in current_paths]
    changed += [{**x, "changed": True} for x in removed]
    initialize_static_files(output_root)
    if not changed:
        print("No input changes; dashboard files left unchanged.")
        return

    telemetry = [x for x in infos if x["kind"] == "telemetry"]
    controllers = [x for x in infos if x["kind"] == "controller"]
    wave_files = [Path(x["path"]) for x in infos if x["kind"] == "wave"]
    nextwave_files = [Path(x["path"]) for x in infos if x["kind"] == "nextwave"]
    if not telemetry:
        raise FileNotFoundError("No telemetry CSVs were found")
    tele_min = min(x["min"] for x in telemetry if x["min"] is not None)
    tele_max = max(x["max"] for x in telemetry if x["max"] is not None)

    changed_kinds = {x.get("kind") for x in changed}
    if not old_state or "telemetry" in changed_kinds and not old_files:
        start, end = tele_min, tele_max + 60
    else:
        ranges = [(x.get("min"), x.get("max")) for x in changed if x.get("kind") == "telemetry"]
        ranges += [(x.get("min"), x.get("max")) for x in changed if x.get("kind") == "telemetry"]
        if "controller" in changed_kinds:
            ranges.append((min(x["min"] for x in changed if x.get("kind") == "controller" and x.get("min") is not None), tele_max))
        ranges = [(a, b) for a, b in ranges if a is not None and b is not None]
        if not ranges:
            state = {"version": 1, "files": {x["path"]: {k: v for k, v in x.items() if k not in {"path", "changed"}} for x in infos}}
            state_path.write_text(json.dumps(state, indent=2) + "\n")
            print("Only unimplemented additional CSVs changed; dashboard files left unchanged.")
            return
        start = np.floor(min(a for a, _ in ranges) / 60) * 60
        end = (np.floor(max(b for _, b in ranges) / 60) + 1) * 60
    start = float(np.floor(start / 60) * 60)
    end = float((np.floor(end / 60) + 1) * 60 if end <= start else end)

    selected = [x for x in telemetry if x["max"] is not None and x["min"] < end and x["max"] >= start]
    raw_parts = [read_telemetry(Path(x["path"]), start, end) for x in selected]
    raw = pd.concat(raw_parts, ignore_index=True) if raw_parts else pd.DataFrame()
    if raw.empty:
        raise ValueError("No telemetry samples remain in the affected timestamp range")
    if raw.duplicated(["Timestamp (epoch seconds)", "Source ID"]).any():
        raise ValueError("Duplicate telemetry samples found for the same timestamp and Source ID")
    events = read_controller_logs([Path(x["path"]) for x in controllers])
    if events.empty:
        warn("No usable controller events found; controller values will be Undefined")
    elif events["wall_epoch_seconds"].max() < tele_min or events["wall_epoch_seconds"].min() > tele_max:
        warn("Controller and telemetry wall-clock ranges do not overlap")

    wave = load_wave_data(wave_files, start, end)
    nextwave = load_nextwave_data(nextwave_files, start, end)
    if wave_files and wave.empty:
        warn("Wave CSVs were found but the wave loader is currently a placeholder")
    if nextwave_files and nextwave.empty:
        warn("NextWave CSVs were found but the NextWave loader is currently a placeholder")

    minute_rows = build_minute_rows(raw, events, wave, nextwave)
    data_root = output_root / "data"
    data_root.mkdir(parents=True, exist_ok=True)
    merge_daily(data_root, round_output(minute_rows, MINUTE_FIELDS), start, end)
    rebuild_overview(data_root, start, end)
    update_manifest(output_root)
    state = {"version": 1, "files": {x["path"]: {k: v for k, v in x.items() if k not in {"path", "changed"}} for x in infos}}
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    print(f"Processed {len(raw):,} telemetry rows; affected {start:.0f}–{end:.0f} wall-clock seconds.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, type=Path, help="Root directory scanned recursively for CSV files")
    parser.add_argument("--output-dir", default=Path("./dashboard_output"), type=Path, help="Dashboard output root")
    args = parser.parse_args()
    build(args.input_dir.resolve(), args.output_dir.resolve())


if __name__ == "__main__":
    main()
