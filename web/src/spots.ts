// Spot markers + the click-through panel: last 24 h of observed wind next
// to the HRRR forecast, sampled client-side from the already-baked U/V
// rasters (no extra pipeline product needed for the forecast series).

import maplibregl from 'maplibre-gl';
import type { TextureData } from 'weatherlayers-gl';
import { MS_TO_KT } from './palette.ts';

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  obs?: string;
}

interface Frame {
  fxx: number;
  validTime: string;
  file: string;
}

interface ManifestLike {
  bounds: [number, number, number, number];
  unscale: [number, number];
  run: string;
  frames: Frame[];
  spots?: Spot[];
}

interface ObsPoint {
  t: string;
  spd: number | null;
  dir: number | null;
  gust: number | null;
}

interface ObsJson {
  generated: string;
  sources: Record<string, ObsPoint[]>;
}

interface Pt {
  t: number;
  spd: number;
  dir: number | null;
  gust: number | null;
}

// Series colors — dataviz-validated pair (lightness band + CVD + contrast,
// dark surface). Keep in sync with #sw-obs / #sw-fcst in style.css.
const OBS_COLOR = '#c9821a';
const FCST_COLOR = '#3583cc';

const PAST_H = 24;
const TZ = 'America/Los_Angeles';

// chart geometry in viewBox units (matches <svg viewBox="0 0 380 190">)
const W = 380;
const H = 190;
const M = { l: 30, r: 10, t: 26, b: 22 };

export interface SpotsApi {
  /** Open the panel for an arbitrary map point (M2.5a click-anywhere). */
  openPoint: (lat: number, lon: number) => void;
}

export function setupSpots(
  map: maplibregl.Map,
  manifest: ManifestLike,
  getTexture: (i: number) => Promise<TextureData>,
): SpotsApi {
  const spots = manifest.spots ?? [];

  const panel = document.getElementById('spot-panel') as HTMLDivElement;
  const nameEl = document.getElementById('sp-name') as HTMLDivElement;
  const nowEl = document.getElementById('sp-now') as HTMLDivElement;
  const chart = document.getElementById('sp-chart') as unknown as SVGSVGElement;
  const tooltip = document.getElementById('sp-tooltip') as HTMLDivElement;
  const obsLabel = document.getElementById('sp-obs-label') as HTMLSpanElement;
  const obsLegendItem = obsLabel.parentElement as HTMLSpanElement;
  let pointMarker: maplibregl.Marker | null = null;
  (document.getElementById('sp-close') as HTMLButtonElement).onclick = () => {
    panel.hidden = true;
    pointMarker?.remove();
  };

  let obsCache: ObsJson | null | undefined;
  async function getObs(): Promise<ObsJson | null> {
    if (obsCache !== undefined) return obsCache;
    try {
      const r = await fetch('/data/obs_recent.json', {
        signal: AbortSignal.timeout(8000),
      });
      obsCache = r.ok ? ((await r.json()) as ObsJson) : null;
    } catch {
      obsCache = null;
    }
    return obsCache;
  }

  for (const spot of spots) {
    const el = document.createElement('div');
    el.className = 'spot-marker';
    el.title = spot.name;
    // pointerdown/up instead of 'click': the map's drag handler can swallow
    // the click, and pointer sequences without a trailing click (some touch/
    // automation paths) must still open the panel. Movement guard keeps
    // map-pans that start on the marker from opening it.
    let down: [number, number] | null = null;
    el.addEventListener('pointerdown', (ev) => {
      down = [ev.clientX, ev.clientY];
      ev.stopPropagation();
    });
    el.addEventListener('pointerup', (ev) => {
      const moved = down
        ? Math.hypot(ev.clientX - down[0], ev.clientY - down[1])
        : Infinity;
      down = null;
      if (moved < 6) {
        ev.stopPropagation();
        void openSpot(spot);
      }
    });
    el.tabIndex = 0;
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        void openSpot(spot);
      }
    });
    new maplibregl.Marker({ element: el })
      .setLngLat([spot.lon, spot.lat])
      .addTo(map);
  }

  async function openSpot(spot: Spot): Promise<void> {
    if (spot.id !== 'point') pointMarker?.remove();
    panel.hidden = false;
    nameEl.textContent = spot.name;
    nowEl.textContent = 'loading…';
    obsLegendItem.style.display = spot.obs ? '' : 'none';
    obsLabel.textContent = spot.obs
      ? `obs (${spot.obs.replace(/^ndbc_/, '').toUpperCase()})`
      : 'obs';
    chart.innerHTML = '';
    tooltip.hidden = true;

    const [textures, obs] = await Promise.all([
      Promise.all(manifest.frames.map((_f, i) => getTexture(i))),
      getObs(),
    ]);

    const fcst: Pt[] = manifest.frames.map((f, i) => {
      const { u, v } = sampleUV(
        textures[i], manifest.bounds, manifest.unscale, spot.lon, spot.lat,
      );
      return {
        t: Date.parse(f.validTime),
        spd: Math.hypot(u, v) * MS_TO_KT,
        dir: dirFrom(u, v),
        gust: null,
      };
    });

    const now = Date.now();
    const raw: ObsPoint[] = spot.obs ? (obs?.sources[spot.obs] ?? []) : [];
    const obsPts: Pt[] = raw
      .filter((p) => p.spd != null)
      .map((p) => ({
        t: Date.parse(p.t),
        spd: (p.spd as number) * MS_TO_KT,
        dir: p.dir,
        gust: p.gust != null ? p.gust * MS_TO_KT : null,
      }))
      .filter((p) => p.t >= now - PAST_H * 3_600_000 && p.t <= now);

    const last = obsPts[obsPts.length - 1];
    nowEl.textContent = last
      ? `now ${last.spd.toFixed(1)} kt` +
        (last.gust != null ? ` (g ${last.gust.toFixed(0)})` : '') +
        (last.dir != null ? ` @ ${Math.round(last.dir)}°` : '') +
        ` · ${fmtTime(last.t)}`
      : spot.id === 'point'
        ? 'HRRR 3 km grid · interpolated (no station)' // D10: honest resolution label
        : 'no recent observation';

    // ad-hoc points have no obs history — don't waste 2/3 of the chart on
    // an empty past window
    render(chart, tooltip, obsPts, fcst, now, obsPts.length > 0 ? PAST_H : 3);
  }

  function openPoint(lat: number, lon: number): void {
    const [w, s, e, n] = manifest.bounds;
    if (lat < s || lat > n || lon < w || lon > e) return; // outside data area
    if (!pointMarker) {
      const el = document.createElement('div');
      el.className = 'point-marker';
      pointMarker = new maplibregl.Marker({ element: el });
    }
    pointMarker.setLngLat([lon, lat]).addTo(map);
    void openSpot({
      id: 'point',
      name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      lat,
      lon,
    });
  }

  return { openPoint };
}

/** Nearest-pixel U/V read from an RG-encoded raster (bake.py convention). */
function sampleUV(
  tex: TextureData,
  bounds: [number, number, number, number],
  unscale: [number, number],
  lon: number,
  lat: number,
): { u: number; v: number } {
  const [w, s, e, n] = bounds;
  const bands = tex.data.length / (tex.width * tex.height);
  const px = clamp(Math.round(((lon - w) / (e - w)) * (tex.width - 1)), 0, tex.width - 1);
  const py = clamp(Math.round(((n - lat) / (n - s)) * (tex.height - 1)), 0, tex.height - 1);
  const i = (py * tex.width + px) * bands;
  const conv = (b: number) => unscale[0] + (b / 255) * (unscale[1] - unscale[0]);
  return { u: conv(tex.data[i] as number), v: conv(tex.data[i + 1] as number) };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Meteorological direction (degrees FROM which the wind blows). */
function dirFrom(u: number, v: number): number {
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  });
}

function fmtHour(t: number): string {
  return new Date(t).toLocaleString('en-US', { hour: 'numeric', timeZone: TZ });
}

function localHour(t: number): number {
  return Number(
    new Date(t).toLocaleString('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: TZ,
    }),
  );
}

function render(
  svg: SVGSVGElement,
  tooltip: HTMLDivElement,
  obsPts: Pt[],
  fcst: Pt[],
  now: number,
  pastH: number = PAST_H,
): void {
  const t0 = now - pastH * 3_600_000;
  const t1 = Math.max(fcst[fcst.length - 1]?.t ?? now, now + 6 * 3_600_000);
  const maxV = Math.max(
    10,
    ...obsPts.map((p) => Math.max(p.spd, p.gust ?? 0)),
    ...fcst.map((p) => p.spd),
  );
  const yMax = Math.max(15, Math.ceil(maxV / 5) * 5);

  const x = (t: number) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / yMax) * (H - M.t - M.b);
  const pts = (arr: Pt[]) =>
    arr.map((p) => `${x(p.t).toFixed(1)},${y(p.spd).toFixed(1)}`).join(' ');

  const parts: string[] = [];

  parts.push(
    `<rect x="${M.l}" y="${M.t}" width="${(x(now) - M.l).toFixed(1)}" height="${H - M.t - M.b}" fill="rgba(255,255,255,0.04)"/>`,
  );

  const yLabelStep = yMax > 30 ? 10 : 5;
  for (let v = 0; v <= yMax; v += 5) {
    const yy = y(v).toFixed(1);
    parts.push(
      `<line x1="${M.l}" x2="${W - M.r}" y1="${yy}" y2="${yy}" stroke="rgba(255,255,255,${v === 0 ? 0.25 : 0.07})" stroke-width="1"/>`,
    );
    if (v > 0 && v % yLabelStep === 0) {
      parts.push(
        `<text x="${M.l - 5}" y="${Number(yy) + 3.5}" text-anchor="end" class="tick">${v}</text>`,
      );
    }
  }

  for (let t = Math.ceil(t0 / 3_600_000) * 3_600_000; t <= t1; t += 3_600_000) {
    if (localHour(t) % 6 !== 0) continue;
    const xx = x(t).toFixed(1);
    parts.push(
      `<line x1="${xx}" x2="${xx}" y1="${H - M.b}" y2="${H - M.b + 3}" stroke="rgba(255,255,255,0.35)"/>`,
      `<text x="${xx}" y="${H - 7}" text-anchor="middle" class="tick">${fmtHour(t)}</text>`,
    );
  }

  parts.push(
    `<line x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="${M.t - 4}" y2="${H - M.b}" stroke="rgba(255,255,255,0.4)" stroke-dasharray="3 3"/>`,
  );

  if (obsPts.length > 0) {
    parts.push(
      `<polyline points="${pts(obsPts)}" fill="none" stroke="${OBS_COLOR}" stroke-width="2" stroke-linejoin="round"/>`,
    );
    for (const p of obsPts) {
      if (p.gust != null) {
        parts.push(
          `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.gust).toFixed(1)}" r="1.6" fill="${OBS_COLOR}" opacity="0.45"/>`,
        );
      }
    }
    const lp = obsPts[obsPts.length - 1];
    parts.push(
      `<text x="${(x(lp.t) - 5).toFixed(1)}" y="${(y(lp.spd) - 6).toFixed(1)}" text-anchor="end" class="dlabel" fill="${OBS_COLOR}">obs</text>`,
    );
  }

  if (fcst.length > 0) {
    parts.push(
      `<polyline points="${pts(fcst)}" fill="none" stroke="${FCST_COLOR}" stroke-width="2" stroke-linejoin="round"/>`,
    );
    for (const p of fcst) {
      parts.push(
        `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.spd).toFixed(1)}" r="2" fill="${FCST_COLOR}"/>`,
      );
    }
    const fl = fcst[fcst.length - 1];
    parts.push(
      `<text x="${x(fl.t).toFixed(1)}" y="${(y(fl.spd) - 7).toFixed(1)}" text-anchor="end" class="dlabel" fill="${FCST_COLOR}">HRRR</text>`,
    );
    // forecast direction arrows (arrow points where the wind is going)
    for (let i = 0; i < fcst.length; i += 2) {
      const p = fcst[i];
      if (p.dir == null) continue;
      parts.push(
        `<path d="M0,-4.2 L3,3.4 L0,1.8 L-3,3.4 Z" transform="translate(${x(p.t).toFixed(1)},${M.t - 12}) rotate(${(p.dir + 180).toFixed(0)})" fill="rgba(232,237,246,0.75)"/>`,
      );
    }
  }

  svg.innerHTML =
    '<style>.tick{font:9px system-ui;fill:rgba(232,237,246,0.6)}.dlabel{font:600 9.5px system-ui}</style>' +
    parts.join('');

  attachHover(svg, tooltip, obsPts, fcst, x, t0, t1);
}

function attachHover(
  svg: SVGSVGElement,
  tooltip: HTMLDivElement,
  obsPts: Pt[],
  fcst: Pt[],
  x: (t: number) => number,
  t0: number,
  t1: number,
): void {
  const ns = 'http://www.w3.org/2000/svg';
  const cross = document.createElementNS(ns, 'line');
  cross.setAttribute('y1', String(M.t));
  cross.setAttribute('y2', String(H - M.b));
  cross.setAttribute('stroke', 'rgba(255,255,255,0.5)');
  cross.setAttribute('visibility', 'hidden');
  svg.appendChild(cross);

  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };

  const nearest = (arr: Pt[], t: number): Pt | null =>
    arr.length > 0
      ? arr.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a))
      : null;

  svg.addEventListener('pointermove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const t = t0 + (((ev.clientX - rect.left) / rect.width) * W - M.l)
      / (W - M.l - M.r) * (t1 - t0);
    if (t < t0 || t > t1) {
      hide();
      return;
    }
    const o = nearest(obsPts, t);
    const f = nearest(fcst, t);
    const bits: string[] = [];
    let anchor = t;
    if (o && Math.abs(o.t - t) < 40 * 60_000) {
      anchor = o.t;
      bits.push(
        `obs ${o.spd.toFixed(1)} kt` +
          (o.gust != null ? ` g${o.gust.toFixed(0)}` : '') +
          (o.dir != null ? ` @${Math.round(o.dir)}°` : ''),
      );
    }
    if (f && Math.abs(f.t - t) <= 45 * 60_000) {
      anchor = f.t;
      bits.push(`HRRR ${f.spd.toFixed(1)} kt @${Math.round(f.dir ?? 0)}°`);
    }
    if (bits.length === 0) {
      hide();
      return;
    }
    const xx = x(anchor);
    cross.setAttribute('x1', xx.toFixed(1));
    cross.setAttribute('x2', xx.toFixed(1));
    cross.setAttribute('visibility', 'visible');
    tooltip.textContent = `${fmtTime(anchor)} · ${bits.join(' · ')}`;
    tooltip.hidden = false;
    const px = (xx / W) * rect.width;
    tooltip.style.top = '24px';
    tooltip.style.left = px < rect.width - 150 ? `${px + 10}px` : '';
    tooltip.style.right = px < rect.width - 150 ? '' : `${rect.width - px + 10}px`;
  });
  svg.addEventListener('pointerleave', hide);
}
