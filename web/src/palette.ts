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

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Continuous lookup: linear interpolation between the palette stops. */
export function colorForKt(kt: number): string {
  const stops = WIND_STOPS_KT;
  if (kt <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (kt <= stops[i][0]) {
      const [k0, c0] = stops[i - 1];
      const [k1, c1] = stops[i];
      const f = (kt - k0) / (k1 - k0);
      const a = hexRgb(c0);
      const b = hexRgb(c1);
      const mix = a.map((x, ch) => Math.round(x + (b[ch] - x) * f));
      return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
    }
  }
  return stops[stops.length - 1][1];
}

/** Ink (text) color that stays readable on a palette-colored cell. */
export function inkFor(cssColor: string): string {
  const m = cssColor.startsWith('#')
    ? hexRgb(cssColor)
    : (cssColor.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
  return lum > 0.35 ? '#0b0e13' : '#e8edf6';
}
