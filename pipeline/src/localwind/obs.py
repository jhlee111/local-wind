"""Collect free wind observations near the South Bay spots.

Sources (all free, no key; times normalized to naive UTC, speeds to m/s):
- ktoa        — KTOA (Torrance airport) METAR via aviationweather.gov API
- ndbc_agxc1  — Angels Gate C-MAN (LA Harbor entrance, off Cabrillo), 6-min
- ndbc_46025  — NDBC buoy 46025 (Santa Monica Basin), offshore reference

CO-OPS 9410660 (San Pedro tide station) was evaluated and REJECTED: its
sensor list has no anemometer (pressure + water level only) — AGXC1 covers
that location better anyway.

Rows accumulate in data/obs/YYYY-MM.parquet (long format, deduped on
source+time). This is the training/validation set for the M4 statistical
correction — the earlier it runs on a schedule, the better (see PLAN.md).

Usage: python -m localwind.obs
"""

from __future__ import annotations

import io
import sys
from datetime import datetime

import numpy as np
import pandas as pd
import requests

from .config import REPO_ROOT

OBS_DIR = REPO_ROOT / "data" / "obs"
COLUMNS = ["time_utc", "source", "wdir_deg", "wspd_ms", "gust_ms"]
KT_TO_MS = 0.514444
UA = {"User-Agent": "local-wind obs collector (personal, non-commercial)"}
TIMEOUT = 20


def fetch_ktoa_metar() -> pd.DataFrame:
    url = "https://aviationweather.gov/api/data/metar"
    r = requests.get(url, params={"ids": "KTOA", "format": "json", "hours": 6},
                     headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    rows = []
    for ob in r.json():
        t = ob.get("obsTime") or ob.get("reportTime")
        if t is None:
            continue
        time_utc = (pd.to_datetime(t, unit="s") if isinstance(t, (int, float))
                    else pd.to_datetime(t))
        wdir = pd.to_numeric(ob.get("wdir"), errors="coerce")  # "VRB" → NaN
        rows.append({
            "time_utc": time_utc.tz_localize(None) if time_utc.tzinfo else time_utc,
            "source": "ktoa",
            "wdir_deg": float(wdir) if pd.notna(wdir) else np.nan,
            "wspd_ms": _num(ob.get("wspd")) * KT_TO_MS,
            "gust_ms": _num(ob.get("wgst")) * KT_TO_MS,
        })
    return pd.DataFrame(rows, columns=COLUMNS)


def fetch_ndbc(station: str, max_rows: int = 120) -> pd.DataFrame:
    """NDBC realtime2 text feed (newest rows first; 'MM' = missing).

    Header: #YY  MM DD hh mm WDIR WSPD GST ...  — month is 'MM', minute 'mm'
    (case-sensitive), WSPD/GST already m/s, WDIR degrees true.
    """
    url = f"https://www.ndbc.noaa.gov/data/realtime2/{station.upper()}.txt"
    r = requests.get(url, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text), sep=r"\s+", skiprows=[1], nrows=max_rows,
                     na_values=["MM"])
    df = df.rename(columns={"#YY": "YY"})
    time_utc = pd.to_datetime(dict(year=df.YY, month=df.MM, day=df.DD,
                                   hour=df.hh, minute=df["mm"]))
    return pd.DataFrame({
        "time_utc": time_utc,
        "source": f"ndbc_{station.lower()}",
        "wdir_deg": pd.to_numeric(df.get("WDIR"), errors="coerce"),
        "wspd_ms": pd.to_numeric(df.get("WSPD"), errors="coerce"),
        "gust_ms": pd.to_numeric(df.get("GST"), errors="coerce"),
    }, columns=COLUMNS)


def _num(x) -> float:
    v = pd.to_numeric(x, errors="coerce")
    return float(v) if pd.notna(v) else np.nan


def append_dedup(new: pd.DataFrame) -> dict[str, int]:
    """Merge rows into monthly parquet files, deduped on (source, time_utc)."""
    OBS_DIR.mkdir(parents=True, exist_ok=True)
    added = {}
    new = new.dropna(subset=["time_utc"])
    for period, chunk in new.groupby(new.time_utc.dt.to_period("M")):
        path = OBS_DIR / f"{period}.parquet"
        old = pd.read_parquet(path) if path.exists() else pd.DataFrame(columns=COLUMNS)
        before = len(old)
        merged = (pd.concat([old, chunk], ignore_index=True)
                  .drop_duplicates(subset=["source", "time_utc"], keep="last")
                  .sort_values(["source", "time_utc"], ignore_index=True))
        merged.to_parquet(path, index=False)
        added[str(period)] = len(merged) - before
    return added


def main() -> int:
    fetchers = {
        "ktoa": fetch_ktoa_metar,
        "ndbc_agxc1": lambda: fetch_ndbc("agxc1"),   # LA Harbor entrance / Cabrillo
        "ndbc_46025": lambda: fetch_ndbc("46025"),   # Santa Monica Basin offshore
    }
    frames, failures = [], []
    for name, fn in fetchers.items():
        try:
            df = fn()
            frames.append(df)
            latest = df.dropna(subset=["wspd_ms"]).sort_values("time_utc").tail(1)
            if len(latest):
                row = latest.iloc[0]
                print(f"  {name:14} latest {row.time_utc:%m-%d %H:%M}Z  "
                      f"{row.wspd_ms:4.1f} m/s @ {row.wdir_deg:5.0f}°  "
                      f"gust {row.gust_ms if pd.notna(row.gust_ms) else float('nan'):4.1f}")
            else:
                print(f"  {name:14} fetched {len(df)} rows (no valid speed)")
        except Exception as e:  # one source failing must not kill the collection
            failures.append(name)
            print(f"  {name:14} FAILED: {type(e).__name__}: {e}")

    if not frames:
        print("all sources failed")
        return 1
    added = append_dedup(pd.concat(frames, ignore_index=True))
    print(f"appended rows per month-file: {added}  → {OBS_DIR}")
    return 0 if not failures else 2


if __name__ == "__main__":
    sys.exit(main())
