"""Export recent observations to web/public/data/obs_recent.json.

The spot panel plots the last ~24 h of measured wind next to the HRRR
forecast. Runs in the bake workflow (after checkout, so it sees the parquet
committed by the obs workflow); locally it reads whatever has been collected.

Usage: python -m localwind.export_obs
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone

import pandas as pd

from .config import REPO_ROOT, WEB_DATA_DIR

OBS_DIR = REPO_ROOT / "data" / "obs"
WINDOW_H = 48


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def main() -> int:
    files = sorted(OBS_DIR.glob("*.parquet"))[-2:]  # current + previous month
    sources: dict[str, list[dict]] = {}
    if files:
        df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
        df = df[df.time_utc >= utcnow_naive() - timedelta(hours=WINDOW_H)]
        df = df.sort_values("time_utc")
        for src, g in df.groupby("source"):
            sources[str(src)] = [
                {
                    "t": r.time_utc.strftime("%Y-%m-%dT%H:%M:00Z"),
                    "spd": None if pd.isna(r.wspd_ms) else round(float(r.wspd_ms), 2),
                    "dir": None if pd.isna(r.wdir_deg) else round(float(r.wdir_deg)),
                    "gust": None if pd.isna(r.gust_ms) else round(float(r.gust_ms), 2),
                }
                for r in g.itertuples()
            ]

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = WEB_DATA_DIR / "obs_recent.json"
    out.write_text(json.dumps({
        "generated": utcnow_naive().strftime("%Y-%m-%dT%H:%M:00Z"),
        "windowHours": WINDOW_H,
        "sources": sources,
    }))
    n = sum(len(v) for v in sources.values())
    print(f"wrote {out} ({n} pts across {len(sources)} sources)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
