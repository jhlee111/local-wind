"""M1 sanity check: one static wind map PNG from the latest HRRR analysis.

Usage: python -m localwind.plot_once [--fxx 0]
Writes pipeline/out/wind_latest.png
"""

from __future__ import annotations

import argparse
import sys
from zoneinfo import ZoneInfo

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .config import OUT_DIR, SPOTS
from .fetch import fetch_uv10, find_latest_run, lon_to_pm180

MS_TO_KT = 1.94384


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fxx", type=int, default=0, help="forecast hour to plot")
    args = ap.parse_args(argv)

    run = find_latest_run()
    ds = fetch_uv10(run, args.fxx)
    lon = lon_to_pm180(ds.longitude.values)
    lat = ds.latitude.values
    u_kt = ds.u10.values * MS_TO_KT
    v_kt = ds.v10.values * MS_TO_KT
    speed_kt = np.hypot(u_kt, v_kt)

    valid_utc = ds.valid_time.values.astype("datetime64[s]").item()
    valid_local = valid_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(
        ZoneInfo("America/Los_Angeles"))

    fig, ax = plt.subplots(figsize=(10, 8.5), dpi=150)
    pm = ax.pcolormesh(lon, lat, speed_kt, cmap="viridis", vmin=0, vmax=30,
                       shading="auto")
    step = 2  # HRRR ~3 km → barbs every ~6 km
    ax.barbs(lon[::step, ::step], lat[::step, ::step],
             u_kt[::step, ::step], v_kt[::step, ::step],
             length=5, linewidth=0.6, color="white")
    for name, (slat, slon) in SPOTS.items():
        ax.plot(slon, slat, "r^", markersize=9)
        ax.annotate(name, (slon, slat), textcoords="offset points", xytext=(6, 4),
                    color="red", fontsize=9, fontweight="bold")
    fig.colorbar(pm, ax=ax, label="10 m wind speed (kt)", shrink=0.85)
    ax.set_title(
        f"HRRR 10 m wind — run {run:%Y-%m-%d %H}Z f{args.fxx:02d}\n"
        f"valid {valid_local:%a %Y-%m-%d %H:%M %Z}")
    ax.set_xlabel("lon")
    ax.set_ylabel("lat")
    ax.set_aspect(1 / np.cos(np.deg2rad(33.7)))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "wind_latest.png"
    fig.savefig(out, bbox_inches="tight")
    print(f"wrote {out}  (speed max {speed_kt.max():.1f} kt)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
