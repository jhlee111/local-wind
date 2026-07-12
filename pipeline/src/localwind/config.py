"""Domain parameters and paths. Keep in sync with docs/PLAN.md."""

from pathlib import Path

# Display/bake domain: Santa Monica Bay → Long Beach, Catalina included
# (eddy / channel flow context). See PLAN.md "도메인 파라미터".
BBOX = {"west": -119.0, "south": 33.2, "east": -117.8, "north": 34.2}

# Extra margin (deg) when cropping the HRRR grid so interpolation covers the
# full target grid (HRRR is ~0.03°; 0.1° ≈ 3 grid cells).
CROP_MARGIN = 0.1

# Regular lat/lon grid the web rasters are interpolated onto (~1.1 km).
TARGET_RES_DEG = 0.01

# Fixed PNG encoding range [-UNSCALE, +UNSCALE] m/s — constant across frames
# so animation brightness is comparable between hours.
UNSCALE = 40.0

# Spot markers / point forecasts & validation anchors. "obs" names the
# source id in data/obs (see obs.py) whose sensor best represents the spot.
SPOTS = {
    "cabrillo": {
        "name": "Cabrillo Beach",
        "lat": 33.708,
        "lon": -118.286,
        "obs": "ndbc_agxc1",  # Angels Gate — harbor entrance, nearest anemometer
    },
}

PIPELINE_ROOT = Path(__file__).resolve().parents[2]  # pipeline/
REPO_ROOT = PIPELINE_ROOT.parent
CACHE_DIR = PIPELINE_ROOT / ".cache" / "herbie"
OUT_DIR = PIPELINE_ROOT / "out"
WEB_DATA_DIR = REPO_ROOT / "web" / "public" / "data"
