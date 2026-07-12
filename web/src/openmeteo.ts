// M2.6 UX-5 — ad-hoc point week forecast via Open-Meteo (free, keyless —
// the D1 $0 constraint). Returns the same SeriesPt shape as the baked spot
// series, so the week table and day-window chart render identically for
// spots and arbitrary map points (D13: one sheet, same UI). D10: callers
// label the source "Open-Meteo" in the chart legend and table caption.

import type { SeriesPt } from './spots.ts';

interface OpenMeteoHourly {
  time: string[];
  wind_speed_10m: (number | null)[];
  wind_direction_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
}

// keyed to ~1 km so repeated taps around the same place reuse one request
const cache = new Map<string, Promise<SeriesPt[] | null>>();

export function fetchPointSeries(
  lat: number,
  lon: number,
): Promise<SeriesPt[] | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let p = cache.get(key);
  if (!p) {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&forecast_days=8&wind_speed_unit=ms&timezone=UTC';
    p = fetch(url, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ hourly?: OpenMeteoHourly }>) : null))
      .then((j) => {
        const h = j?.hourly;
        if (!h || !Array.isArray(h.time) || h.time.length === 0) return null;
        const pts: SeriesPt[] = [];
        for (let i = 0; i < h.time.length; i++) {
          const spd = h.wind_speed_10m[i];
          if (spd == null) continue;
          pts.push({
            t: `${h.time[i]}:00Z`, // API returns "YYYY-MM-DDTHH:mm" in UTC
            spd,
            gust: h.wind_gusts_10m?.[i] ?? null,
            dir: h.wind_direction_10m?.[i] ?? 0,
            src: 'open-meteo',
          });
        }
        return pts.length > 0 ? pts : null;
      })
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}
