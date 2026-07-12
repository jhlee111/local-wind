"""Bake per-spot point-forecast series for the week table (M2.5b, D9).

Near range comes from our own HRRR (native 1 h, f00–f18 — same source as
the map rasters, so panel and map agree); beyond that GFS 0.25° 3-hourly
out to f168 (~7 days). Speeds stay in m/s (client converts to kt), dir is
degrees-FROM. NBM (calibrated point guidance) is the planned upgrade.

Output: web/public/data/spots_series.json
Usage: python -m localwind.spot_series
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import xarray as xr
from herbie import Herbie

from .config import CACHE_DIR, SPOTS, WEB_DATA_DIR
from .fetch import SEARCH_UV10, find_latest_run, lon_to_pm180

SEARCH_GUST = ":GUST:surface:"
HRRR_MAX_FXX = 18  # hourly cycles publish f00–f18


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def dir_from(u: float, v: float) -> float:
    """Meteorological direction (degrees FROM which the wind blows)."""
    return float((np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0)


def herbie_ds(run: datetime, model: str, product: str, fxx: int, search: str) -> xr.Dataset:
    h = Herbie(run, model=model, product=product, fxx=fxx,
               save_dir=CACHE_DIR, verbose=False)
    ds = h.xarray(search)
    if isinstance(ds, list):
        ds = xr.merge(ds, compat="override")
    return ds


def find_latest_gfs_run(probe_fxx: int = 168, cycles_back: int = 4) -> datetime:
    """GFS runs 00/06/12/18Z and takes ~4 h to publish out to f168."""
    now = utcnow_naive()
    latest = now.replace(minute=0, second=0, microsecond=0,
                         hour=(now.hour // 6) * 6)
    for k in range(cycles_back + 1):
        run = latest - timedelta(hours=6 * k)
        try:
            h = Herbie(run, model="gfs", product="pgrb2.0p25", fxx=probe_fxx,
                       save_dir=CACHE_DIR, verbose=False)
            if h.grib is not None:
                return run
        except Exception:
            continue
    raise RuntimeError("no complete GFS run found")


def gust_value(ds: xr.Dataset, picker) -> float | None:
    try:
        g = float(picker(ds["gust"]))
        return round(g, 2) if np.isfinite(g) else None
    except Exception:
        return None


def main() -> int:
    series: dict[str, list[dict]] = {sid: [] for sid in SPOTS}

    # --- HRRR 1 h, f00–f18 (nearest grid point on the 2-D Lambert grid) ---
    hrun = find_latest_run(probe_fxx=HRRR_MAX_FXX)
    print(f"HRRR run {hrun:%Y-%m-%d %H}Z f00–f{HRRR_MAX_FXX}")
    idx2d: dict[str, tuple[int, int]] = {}
    for fxx in range(HRRR_MAX_FXX + 1):
        uv = herbie_ds(hrun, "hrrr", "sfc", fxx, SEARCH_UV10)
        gu = herbie_ds(hrun, "hrrr", "sfc", fxx, SEARCH_GUST)
        for sid, spec in SPOTS.items():
            if sid not in idx2d:
                d2 = ((uv.latitude.values - spec["lat"]) ** 2
                      + (lon_to_pm180(uv.longitude.values) - spec["lon"]) ** 2)
                j, i = np.unravel_index(int(np.argmin(d2)), d2.shape)
                idx2d[sid] = (int(j), int(i))
            j, i = idx2d[sid]
            u = float(uv.u10.values[j, i])
            v = float(uv.v10.values[j, i])
            valid = hrun + timedelta(hours=fxx)
            series[sid].append({
                "t": valid.strftime("%Y-%m-%dT%H:00:00Z"),
                "spd": round(float(np.hypot(u, v)), 2),
                "gust": gust_value(gu, lambda da: da.values[j, i]),
                "dir": round(dir_from(u, v)),
                "src": "hrrr",
            })

    # --- GFS 3 h beyond the HRRR window, out to ~7 days ---
    grun = find_latest_gfs_run()
    hrrr_end = hrun + timedelta(hours=HRRR_MAX_FXX)
    print(f"GFS run {grun:%Y-%m-%d %H}Z (beyond {hrrr_end:%m-%d %H}Z)")
    for fxx in range(0, 169, 3):
        valid = grun + timedelta(hours=fxx)
        if valid <= hrrr_end:
            continue
        uv = herbie_ds(grun, "gfs", "pgrb2.0p25", fxx, SEARCH_UV10)
        gu = herbie_ds(grun, "gfs", "pgrb2.0p25", fxx, SEARCH_GUST)
        for sid, spec in SPOTS.items():
            lon360 = spec["lon"] % 360
            p = uv.sel(latitude=spec["lat"], longitude=lon360, method="nearest")
            u = float(p.u10)
            v = float(p.v10)
            series[sid].append({
                "t": valid.strftime("%Y-%m-%dT%H:00:00Z"),
                "spd": round(float(np.hypot(u, v)), 2),
                "gust": gust_value(
                    gu, lambda da: da.sel(latitude=spec["lat"], longitude=lon360,
                                          method="nearest")),
                "dir": round(dir_from(u, v)),
                "src": "gfs",
            })

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = WEB_DATA_DIR / "spots_series.json"
    out.write_text(json.dumps({
        "generated": utcnow_naive().strftime("%Y-%m-%dT%H:%M:00Z"),
        "spots": {
            sid: {"name": spec["name"], "series": series[sid]}
            for sid, spec in SPOTS.items()
        },
    }))
    n = {sid: len(v) for sid, v in series.items()}
    print(f"wrote {out} entries={n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
