"""Fetch HRRR 10 m wind for the South Bay domain via Herbie (AWS open data).

Herbie downloads only the GRIB messages matching the search string
(byte-range requests against the .idx), then we crop to the bbox locally —
the HRRR Lambert grid has 2-D lat/lon coords, so cropping is a mask + isel.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import xarray as xr
from herbie import Herbie

from .config import BBOX, CACHE_DIR, CROP_MARGIN

SEARCH_UV10 = ":[UV]GRD:10 m above ground:"


def find_latest_run(max_lookback_hours: int = 6) -> datetime:
    """Most recent HRRR cycle whose files exist on AWS (runs lag ~1 h).

    Returns a NAIVE datetime in UTC — Herbie rejects tz-aware timestamps
    ("Cannot compare tz-naive and tz-aware timestamps").
    """
    now = (datetime.now(timezone.utc)
           .replace(minute=0, second=0, microsecond=0, tzinfo=None))
    for back in range(1, max_lookback_hours + 1):
        run = now - timedelta(hours=back)
        try:
            h = Herbie(run, model="hrrr", product="sfc", fxx=1,
                       save_dir=CACHE_DIR, verbose=False)
            if h.grib is not None:
                return run
        except Exception:
            continue
    raise RuntimeError(f"No HRRR run found on AWS within {max_lookback_hours} h lookback")


def fetch_uv10(run: datetime, fxx: int) -> xr.Dataset:
    """10 m u/v for one forecast hour, cropped to the South Bay bbox."""
    h = Herbie(run, model="hrrr", product="sfc", fxx=fxx,
               save_dir=CACHE_DIR, verbose=False)
    ds = h.xarray(SEARCH_UV10)
    if isinstance(ds, list):  # multiple hypercubes — merge (u/v are same level type)
        ds = xr.merge(ds, compat="override")
    return crop_to_bbox(ds)


def crop_to_bbox(ds: xr.Dataset) -> xr.Dataset:
    lat = ds.latitude.values
    lon = ds.longitude.values  # HRRR stores 0–360 degrees_east
    west = (BBOX["west"] - CROP_MARGIN) % 360
    east = (BBOX["east"] + CROP_MARGIN) % 360
    mask = (
        (lat >= BBOX["south"] - CROP_MARGIN)
        & (lat <= BBOX["north"] + CROP_MARGIN)
        & (lon >= west)
        & (lon <= east)
    )
    jj, ii = np.where(mask)
    if jj.size == 0:
        raise RuntimeError("bbox crop selected no HRRR grid points — check BBOX")
    return ds.isel(y=slice(jj.min(), jj.max() + 1), x=slice(ii.min(), ii.max() + 1))


def lon_to_pm180(lon: np.ndarray) -> np.ndarray:
    """0–360 → −180..180."""
    return (lon + 180.0) % 360.0 - 180.0
