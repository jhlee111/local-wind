// Wind-speed palette, keyed to sailing-relevant knots.
//
// Design (see docs/PLAN.md M2): lightness rises monotonically calm→extreme
// (dark navy → white-pink), so magnitude is legible by brightness alone —
// CVD-safe without relying on hue. Hue adds band discrimination and the
// weather-map idiom; the hot end (red→pink→white) doubles as a reserved
// "too strong" warning. Source of truth is KNOTS (the wind-sports unit);
// converted to m/s for WeatherLayers, which reads magnitude in native m/s.

export const KT_TO_MS = 0.514444;
export const MS_TO_KT = 1 / KT_TO_MS;

/** [knots, hex] — ordered, lightness-increasing. */
export const WIND_STOPS_KT: readonly [number, string][] = [
  [0, '#08214a'], // calm — dark navy
  [6, '#2166ac'], // light air (blue)
  [10, '#4393c3'], // marginal (light blue)
  [13, '#35978f'], // sailable begins (teal)
  [16, '#5aae61'], // good (green)
  [19, '#a6d96a'], // solid (yellow-green)
  [22, '#fdae61'], // powered (orange)
  [26, '#f46d43'], // strong (orange-red)
  [30, '#d73027'], // caution (red)
  [36, '#f768a1'], // very strong (pink)
  [45, '#fce7f0'], // extreme (white-pink)
];

/** Legend axis spans 0 … this (knots). */
export const LEGEND_MAX_KT = 45;

/** Labeled ticks under the legend bar. */
export const LEGEND_TICKS_KT = [0, 10, 15, 20, 25, 30, 40];

/** WeatherLayers Palette entries: [value_in_m_per_s, color]. */
export const WIND_PALETTE: [number, string][] = WIND_STOPS_KT.map(
  ([kt, hex]) => [kt * KT_TO_MS, hex],
);

/** CSS `linear-gradient(...)` mirroring the palette across the legend axis. */
export function legendGradient(): string {
  const stops = WIND_STOPS_KT.map(
    ([kt, hex]) => `${hex} ${((kt / LEGEND_MAX_KT) * 100).toFixed(1)}%`,
  );
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
