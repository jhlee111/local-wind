# local-wind

Free, self-hosted windy-style wind map for the South Bay coast (Torrance / San Pedro / Palos Verdes, SoCal). HRRR-based, terrain-aware later. For windsurf / kite / wing foil.

- Plan & decisions: [docs/PLAN.md](docs/PLAN.md)
- Research (fact-checked): [docs/research-wind-forecast.md](docs/research-wind-forecast.md)

## Layout

- `pipeline/` — Python (uv). Fetches HRRR 10 m wind via Herbie (AWS open data, anonymous), crops to the South Bay bbox, bakes PNG-encoded U/V rasters + `wind.json` manifest for the web map.
- `web/` — Vite + TypeScript. MapLibre GL basemap + WeatherLayers GL particle layer reading the baked data.

## Quickstart

```bash
# 1) bake wind data from the latest HRRR run (writes web/public/data/)
uv run --project pipeline python -m localwind.bake

# one-off static plot (M1 sanity check → pipeline/out/wind_latest.png)
uv run --project pipeline python -m localwind.plot_once

# 2) run the web map
npm --prefix web install
npm --prefix web run dev   # http://localhost:5173
```

Data: NOAA HRRR via [AWS Open Data](https://registry.opendata.aws/noaa-hrrr-pds/). Basemap: OpenFreeMap / OpenStreetMap.
