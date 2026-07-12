"""Bake HRRR 10 m wind into web assets:

- wind_fNN.png — U/V encoded in R/G channels (webgl-wind / WeatherLayers
  convention), regular lat/lon grid, north-up, fixed unscale range.
- wind.json — manifest: bounds, unscale, run time, frame list.

Usage: python -m localwind.bake [--frames 13] [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import timedelta

import numpy as np
from PIL import Image
from scipy.interpolate import griddata

from .config import BBOX, TARGET_RES_DEG, UNSCALE, WEB_DATA_DIR
from .fetch import fetch_uv10, find_latest_run, lon_to_pm180


def target_grid():
    lons = np.arange(BBOX["west"], BBOX["east"] + 1e-9, TARGET_RES_DEG)
    lats = np.arange(BBOX["north"], BBOX["south"] - 1e-9, -TARGET_RES_DEG)  # north-up rows
    return np.meshgrid(lons, lats)


def regrid(values: np.ndarray, src_lon: np.ndarray, src_lat: np.ndarray,
           grid_lon: np.ndarray, grid_lat: np.ndarray) -> np.ndarray:
    pts = np.column_stack([src_lon.ravel(), src_lat.ravel()])
    out = griddata(pts, values.ravel(), (grid_lon, grid_lat), method="linear")
    holes = np.isnan(out)
    if holes.any():
        out[holes] = griddata(pts, values.ravel(), (grid_lon[holes], grid_lat[holes]),
                              method="nearest")
    return out


def encode_png(u: np.ndarray, v: np.ndarray, path) -> None:
    """R=u, G=v scaled from [-UNSCALE, UNSCALE] to 0–255; B unused; A=255."""
    def chan(x):
        return np.clip((x / UNSCALE + 1.0) / 2.0 * 255.0, 0, 255).astype(np.uint8)

    h, w = u.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = chan(u)
    rgba[..., 1] = chan(v)
    rgba[..., 3] = 255
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=13, help="forecast hours f00..f{N-1}")
    ap.add_argument("--out", default=str(WEB_DATA_DIR), help="output directory")
    args = ap.parse_args(argv)

    from pathlib import Path
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    run = find_latest_run(probe_fxx=args.frames - 1)
    print(f"HRRR run: {run:%Y-%m-%d %H}Z, baking f00..f{args.frames - 1:02d} → {out_dir}")

    grid_lon, grid_lat = target_grid()
    frames = []
    for fxx in range(args.frames):
        ds = fetch_uv10(run, fxx)
        src_lon = lon_to_pm180(ds.longitude.values)
        src_lat = ds.latitude.values
        u = regrid(ds.u10.values, src_lon, src_lat, grid_lon, grid_lat)
        v = regrid(ds.v10.values, src_lon, src_lat, grid_lon, grid_lat)
        name = f"wind_f{fxx:02d}.png"
        encode_png(u, v, out_dir / name)
        valid = run + timedelta(hours=fxx)
        frames.append({"fxx": fxx, "validTime": valid.strftime("%Y-%m-%dT%H:00:00Z"),
                       "file": name})
        spd = np.hypot(u, v)
        print(f"  f{fxx:02d} valid {valid:%m-%d %H}Z  "
              f"speed mean {spd.mean():4.1f} max {spd.max():4.1f} m/s → {name}")

    manifest = {
        "bounds": [BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"]],
        "unscale": [-UNSCALE, UNSCALE],
        "run": run.strftime("%Y-%m-%dT%H:00:00Z"),
        "model": "hrrr",
        "frames": frames,
    }
    (out_dir / "wind.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {out_dir / 'wind.json'} ({len(frames)} frames)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
