// Spot markers + the click-through panel. The detail chart shows the local
// day the selected time T falls in (master-detail with the week table: tap a
// column → T moves → chart follows; past days become a verification view of
// obs vs forecast). Spots draw the forecast from the baked 8-day point
// series; ad-hoc map points still sample the U/V rasters client-side
// (series for those arrives with Open-Meteo in UX-5).

import maplibregl from 'maplibre-gl';
import type { TextureData } from 'weatherlayers-gl';
import { fetchPointSeries } from './openmeteo.ts';
import { MS_TO_KT, colorForKt, inkFor } from './palette.ts';
import { sheetEnsureVisible } from './sheet.ts';
import {
  TZ,
  dayKey,
  extendTimes,
  localMidnightAtOrBefore,
  nearestIdx,
  selectTime,
  selectedMs,
  subscribe,
} from './state.ts';

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

export interface SeriesPt {
  t: string;
  spd: number;
  gust: number | null;
  dir: number;
  src: string;
}

export interface SeriesJson {
  generated: string;
  spots: Record<string, { name: string; series: SeriesPt[] }>;
}

// Shared, memoized spots_series.json fetch — the panel (week table + chart)
// and the time store (8-day selectable range, main.ts) all read from it.
let seriesPromise: Promise<SeriesJson | null> | undefined;
export function loadSeries(): Promise<SeriesJson | null> {
  seriesPromise ??= fetch('/data/spots_series.json', {
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => (r.ok ? (r.json() as Promise<SeriesJson>) : null))
    .catch(() => null);
  return seriesPromise;
}

interface Pt {
  t: number;
  spd: number;
  dir: number | null;
  gust: number | null;
  /** model source of this point ("hrrr" | "gfs" | "open-meteo") */
  src?: string;
}

// Series colors — dataviz-validated pair (lightness band + CVD + contrast,
// dark surface). Keep in sync with #sw-obs / #sw-fcst in style.css.
const OBS_COLOR = '#c9821a';
const FCST_COLOR = '#3583cc';

const PAST_H = 24;
const HOUR = 3_600_000;

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

  const tableEl = document.getElementById('sp-table') as HTMLDivElement;

  // D12, write side: any cell (3 h step) or day header (that day's noon)
  // moves the shared T. One delegated listener survives table re-renders.
  tableEl.addEventListener('click', (ev) => {
    const td = (ev.target as HTMLElement).closest('td[data-ms]');
    if (td instanceof HTMLElement && td.dataset.ms) {
      selectTime(Number(td.dataset.ms));
    }
  });

  setupChartHover(chart, tooltip);

  // D12, read side: while the panel is open the week table highlight, the
  // chart T-cursor, and the chart's day window all track the store.
  let openSeries: SeriesPt[] = [];
  let openSrc = '';
  subscribe(() => {
    if (panel.hidden) return;
    if (chartData && !chartData.fixedWindow) {
      const key = dayKey(selectedMs());
      if (key !== chartDayKey) {
        chartDayKey = key;
        renderChart();
      }
    }
    positionChartCursor();
    if (openSeries.length === 0) return;
    const scroll = tableEl.scrollLeft; // innerHTML swap must not reset it
    renderWeekTable(tableEl, openSeries, openSrc);
    tableEl.scrollLeft = scroll;
  });

  async function openSpot(spot: Spot): Promise<void> {
    if (spot.id !== 'point') pointMarker?.remove();
    panel.hidden = false;
    sheetEnsureVisible(); // mobile: a peeked sheet pops to half on new content
    nameEl.textContent = spot.name;
    nowEl.textContent = 'loading…';
    obsLegendItem.style.display = spot.obs ? '' : 'none';
    obsLabel.textContent = spot.obs
      ? `obs (${spot.obs.replace(/^ndbc_/, '').toUpperCase()})`
      : 'obs';
    chart.innerHTML = '';
    tooltip.hidden = true;
    tableEl.hidden = true;

    // Week series: baked HRRR+GFS for named spots, Open-Meteo client fetch
    // for ad-hoc points (UX-5) — same shape, so the whole panel renders
    // identically for both (D13: one sheet, same UI).
    const isPoint = spot.id === 'point';
    const [obs, seriesJson, pointSeries] = await Promise.all([
      getObs(),
      isPoint ? Promise.resolve(null) : loadSeries(),
      isPoint ? fetchPointSeries(spot.lat, spot.lon) : Promise.resolve(null),
    ]);

    const weekSeries = isPoint
      ? (pointSeries ?? [])
      : (seriesJson?.spots[spot.id]?.series ?? []);
    const srcLabel = seriesSrcLabel(weekSeries);
    openSeries = weekSeries;
    openSrc = srcLabel;
    if (weekSeries.length > 0) {
      renderWeekTable(tableEl, weekSeries, srcLabel);
      tableEl.hidden = false;
      if (isPoint) {
        // make the point's future instants selectable (Open-Meteo starts at
        // 00 UTC today — don't drag the timeline into the past)
        extendTimes(
          weekSeries
            .map((p) => Date.parse(p.t))
            .filter((ms) => ms >= Date.now() - 1.5 * HOUR),
        );
      }
    }

    // Forecast for the chart: the week series when we have it (drives the
    // day-window chart across the whole week); otherwise sample the U/V
    // rasters (series fetch failed — fixed legacy window).
    const fcstLabel = weekSeries.length > 0 ? srcLabel : 'HRRR';
    let fcstAll: Pt[];
    if (weekSeries.length > 0) {
      fcstAll = weekSeries.map((p) => ({
        t: Date.parse(p.t),
        spd: p.spd * MS_TO_KT,
        dir: p.dir,
        gust: p.gust != null ? p.gust * MS_TO_KT : null,
        src: p.src,
      }));
    } else {
      const textures = await Promise.all(
        manifest.frames.map((_f, i) => getTexture(i)),
      );
      fcstAll = manifest.frames.map((f, i) => {
        const { u, v } = sampleUV(
          textures[i], manifest.bounds, manifest.unscale, spot.lon, spot.lat,
        );
        return {
          t: Date.parse(f.validTime),
          spd: Math.hypot(u, v) * MS_TO_KT,
          dir: dirFrom(u, v),
          gust: null,
          src: 'hrrr',
        };
      });
    }
    (document.getElementById('sp-fcst-label') as HTMLSpanElement).textContent =
      fcstLabel;

    const raw: ObsPoint[] = spot.obs ? (obs?.sources[spot.obs] ?? []) : [];
    const obsAll: Pt[] = raw
      .filter((p) => p.spd != null)
      .map((p) => ({
        t: Date.parse(p.t),
        spd: (p.spd as number) * MS_TO_KT,
        dir: p.dir,
        gust: p.gust != null ? p.gust * MS_TO_KT : null,
      }));

    const last = obsAll[obsAll.length - 1];
    nowEl.textContent = last
      ? `now ${last.spd.toFixed(1)} kt` +
        (last.gust != null ? ` (g ${last.gust.toFixed(0)})` : '') +
        (last.dir != null ? ` @ ${Math.round(last.dir)}°` : '') +
        ` · ${fmtTime(last.t)}`
      : isPoint
        ? // D10: honest source + resolution label for stationless points
          `${fcstLabel === 'HRRR' ? 'HRRR 3 km grid' : fcstLabel} · interpolated (no station)`
        : 'no recent observation';

    chartData = {
      svg: chart,
      tooltip,
      obsAll,
      fcstAll,
      fcstLabel,
      fixedWindow: weekSeries.length === 0,
    };
    chartDayKey = dayKey(selectedMs());
    renderChart();
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

/** Human label for the unique sources in a series ("HRRR + GFS", "Open-Meteo"). */
function seriesSrcLabel(series: { src?: string }[]): string {
  const pretty: Record<string, string> = {
    hrrr: 'HRRR',
    gfs: 'GFS',
    'open-meteo': 'Open-Meteo',
  };
  const srcs = [...new Set(series.map((p) => p.src).filter(Boolean))] as string[];
  return srcs.map((s) => pretty[s] ?? s.toUpperCase()).join(' + ');
}

function fmtChartDay(ms: number): string {
  return new Date(ms)
    .toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      timeZone: TZ,
    })
    .replace(',', '')
    .toUpperCase();
}

// ---- day-window chart (D12 master-detail) ----

interface ChartData {
  svg: SVGSVGElement;
  tooltip: HTMLDivElement;
  obsAll: Pt[];
  fcstAll: Pt[];
  /** Forecast source shown on the line label and hover ("HRRR", "Open-Meteo"). */
  fcstLabel: string;
  /** Fixed legacy window — only when no week series is available at all. */
  fixedWindow: boolean;
}

let chartData: ChartData | null = null;
let chartDayKey: string | null = null;

/** (Re)draw the chart for the current selection's local day. */
function renderChart(): void {
  if (!chartData) return;
  const { svg, tooltip, obsAll, fcstAll, fcstLabel, fixedWindow } = chartData;
  const now = Date.now();

  let t0: number;
  let t1: number;
  let dayLabel = '';
  if (fixedWindow) {
    // ad-hoc points have no obs history — don't waste 2/3 of the chart on
    // an empty past window
    const pastH = obsAll.length > 0 ? PAST_H : 3;
    t0 = now - pastH * HOUR;
    t1 = Math.max(fcstAll[fcstAll.length - 1]?.t ?? now, now + 6 * HOUR);
  } else {
    const dayStart = localMidnightAtOrBefore(selectedMs());
    t0 = dayStart - 1.5 * HOUR;
    t1 = dayStart + 25.5 * HOUR;
    dayLabel = fmtChartDay(dayStart + 12 * HOUR);
  }

  const dayEl = document.getElementById('sp-chart-day');
  if (dayEl) dayEl.textContent = dayLabel;
  tooltip.hidden = true; // window changed under the pointer — stale text

  const fcstWin = fcstAll.filter((p) => p.t >= t0 && p.t <= t1);
  // D10: label the line with the source(s) actually shown in this window
  // (near-term days are HRRR, later days GFS; ad-hoc points Open-Meteo)
  const winLabel = seriesSrcLabel(fcstWin) || fcstLabel;

  render(
    svg,
    obsAll.filter((p) => p.t >= t0 && p.t <= t1),
    fcstWin,
    now,
    t0,
    t1,
    winLabel,
  );
}

// Chart time window of the last render — lets the store subscription move
// the T-cursor without a full chart rebuild (no listener churn).
let chartWin: { svg: SVGSVGElement; t0: number; t1: number } | null = null;

/** Move/show the chart's T-cursor to the store's selected instant. */
function positionChartCursor(): void {
  if (!chartWin) return;
  const cur = chartWin.svg.querySelector('#sp-tcursor');
  if (!cur) return;
  const ms = selectedMs();
  const { t0, t1 } = chartWin;
  if (Number.isNaN(ms) || ms < t0 || ms > t1) {
    cur.setAttribute('visibility', 'hidden');
    return;
  }
  const xx = (M.l + ((ms - t0) / (t1 - t0)) * (W - M.l - M.r)).toFixed(1);
  cur.setAttribute('x1', xx);
  cur.setAttribute('x2', xx);
  cur.setAttribute('visibility', 'visible');
}

function render(
  svg: SVGSVGElement,
  obsPts: Pt[],
  fcst: Pt[],
  now: number,
  t0: number,
  t1: number,
  fcstLabel: string,
): void {
  const maxV = Math.max(
    10,
    ...obsPts.map((p) => Math.max(p.spd, p.gust ?? 0)),
    ...fcst.map((p) => Math.max(p.spd, p.gust ?? 0)),
  );
  const yMax = Math.max(15, Math.ceil(maxV / 5) * 5);

  const x = (t: number) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / yMax) * (H - M.t - M.b);
  const pts = (arr: Pt[]) =>
    arr.map((p) => `${x(p.t).toFixed(1)},${y(p.spd).toFixed(1)}`).join(' ');

  const parts: string[] = [];

  // past shading up to `now`, clamped to the window (full for past days,
  // none for future days)
  const pastEnd = Math.min(Math.max(now, t0), t1);
  parts.push(
    `<rect x="${M.l}" y="${M.t}" width="${(x(pastEnd) - M.l).toFixed(1)}" height="${H - M.t - M.b}" fill="rgba(255,255,255,0.04)"/>`,
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

  for (let t = Math.ceil(t0 / HOUR) * HOUR; t <= t1; t += HOUR) {
    if (localHour(t) % 6 !== 0) continue;
    const xx = x(t).toFixed(1);
    parts.push(
      `<line x1="${xx}" x2="${xx}" y1="${H - M.b}" y2="${H - M.b + 3}" stroke="rgba(255,255,255,0.35)"/>`,
      `<text x="${xx}" y="${H - 7}" text-anchor="middle" class="tick">${fmtHour(t)}</text>`,
    );
  }

  if (now >= t0 && now <= t1) {
    parts.push(
      `<line x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="${M.t - 4}" y2="${H - M.b}" stroke="rgba(255,255,255,0.4)" stroke-dasharray="3 3"/>`,
    );
  }

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
      if (p.gust != null) {
        parts.push(
          `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.gust).toFixed(1)}" r="1.8" fill="${FCST_COLOR}" opacity="0.45"/>`,
        );
      }
    }
    const fl = fcst[fcst.length - 1];
    parts.push(
      `<text x="${x(fl.t).toFixed(1)}" y="${(y(fl.spd) - 7).toFixed(1)}" text-anchor="end" class="dlabel" fill="${FCST_COLOR}">${fcstLabel}</text>`,
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

  parts.push(
    `<line id="sp-hover-cross" y1="${M.t}" y2="${H - M.b}" stroke="rgba(255,255,255,0.5)" visibility="hidden"/>`,
    `<line id="sp-tcursor" y1="${M.t - 4}" y2="${H - M.b}" stroke="#4da3ff" stroke-width="1.5" visibility="hidden"/>`,
  );

  svg.innerHTML =
    '<style>.tick{font:9px system-ui;fill:rgba(232,237,246,0.6)}.dlabel{font:600 9.5px system-ui}</style>' +
    parts.join('');

  chartWin = { svg, t0, t1 };
  positionChartCursor();

  hoverData = { obsPts, fcst, x, t0, t1, fcstLabel };
}

/** windy-style week matrix: 3 h columns × (hour / kt / gust / dir) rows. */
export function renderWeekTable(
  el: HTMLDivElement,
  series: SeriesPt[],
  srcLabel = '',
): void {
  const now = Date.now();
  const pts = series
    .map((p) => ({ ...p, ms: Date.parse(p.t) }))
    .filter((p) => new Date(p.ms).getUTCHours() % 3 === 0)
    .filter((p) => p.ms >= now - 1.5 * HOUR);
  if (pts.length === 0) {
    el.hidden = true;
    return;
  }

  const dayOf = (ms: number) =>
    new Date(ms).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      timeZone: TZ,
    });
  const nowIdx = pts.findIndex((p) => Math.abs(p.ms - now) <= 1.5 * HOUR);
  // D12: column nearest the store's selected instant
  const selMs = selectedMs();
  const selIdx = Number.isNaN(selMs)
    ? -1
    : nearestIdx(pts.map((p) => p.ms), selMs);

  // day header with colspans; click target = that day's local noon
  const dayCells: string[] = [];
  for (let i = 0; i < pts.length; ) {
    const d = dayOf(pts[i].ms);
    let span = 0;
    while (i + span < pts.length && dayOf(pts[i + span].ms) === d) span++;
    const noon = localMidnightAtOrBefore(pts[i].ms) + 12 * HOUR;
    dayCells.push(
      `<td colspan="${span}" data-ms="${noon}">${d.toUpperCase()}</td>`,
    );
    i += span;
  }

  const edge = (i: number) =>
    i > 0 && dayOf(pts[i].ms) !== dayOf(pts[i - 1].ms) ? ' day-edge' : '';
  const cls = (i: number) =>
    `${edge(i)}${i === nowIdx ? ' now-col' : ''}${i === selIdx ? ' sel-col' : ''}`;
  const attrs = (i: number) => `class="${cls(i)}" data-ms="${pts[i].ms}"`;

  const hourCells = pts
    .map((p, i) => `<td ${attrs(i)}>${localHour(p.ms) % 24}</td>`)
    .join('');

  const ktCell = (val: number | null, i: number) => {
    if (val == null) return `<td ${attrs(i)}>–</td>`;
    const kt = val * MS_TO_KT;
    const bg = colorForKt(kt);
    return `<td ${attrs(i)} style="background:${bg};color:${inkFor(bg)}">${Math.round(kt)}</td>`;
  };
  const spdCells = pts.map((p, i) => ktCell(p.spd, i)).join('');
  const gustCells = pts.map((p, i) => ktCell(p.gust, i)).join('');
  const dirCells = pts
    .map((p, i) =>
      `<td ${attrs(i)}><span style="transform:rotate(${(p.dir + 180) % 360}deg)">↑</span></td>`)
    .join('');

  el.innerHTML =
    '<table>' +
    `<tr class="days"><th></th>${dayCells.join('')}</tr>` +
    `<tr class="hours"><th>h</th>${hourCells}</tr>` +
    `<tr class="kt"><th>kt</th>${spdCells}</tr>` +
    `<tr class="gust"><th>gust</th>${gustCells}</tr>` +
    `<tr class="dir"><th>dir</th>${dirCells}</tr>` +
    '</table>' +
    // D10: keep the model source visible where the data is
    (srcLabel ? `<div class="tbl-src">source: ${srcLabel}</div>` : '');
}

// ---- chart hover (one-time listeners; data swapped per render) ----

interface HoverData {
  obsPts: Pt[];
  fcst: Pt[];
  x: (t: number) => number;
  t0: number;
  t1: number;
  fcstLabel: string;
}

let hoverData: HoverData | null = null;

function setupChartHover(svg: SVGSVGElement, tooltip: HTMLDivElement): void {
  const cross = () => svg.querySelector('#sp-hover-cross');
  const hide = () => {
    cross()?.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };

  const nearest = (arr: Pt[], t: number): Pt | null =>
    arr.length > 0
      ? arr.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a))
      : null;

  svg.addEventListener('pointermove', (ev) => {
    if (!hoverData) return;
    const { obsPts, fcst, x, t0, t1, fcstLabel } = hoverData;
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
    // forecast points sit on a 1 h (HRRR) or 3 h (GFS) grid — widen the
    // snap radius so hover works across the whole day window
    if (f && Math.abs(f.t - t) <= 95 * 60_000) {
      anchor = f.t;
      bits.push(
        `${fcstLabel} ${f.spd.toFixed(1)} kt` +
          (f.gust != null ? ` g${f.gust.toFixed(0)}` : '') +
          ` @${Math.round(f.dir ?? 0)}°`,
      );
    }
    if (bits.length === 0) {
      hide();
      return;
    }
    const xx = x(anchor);
    const c = cross();
    c?.setAttribute('x1', xx.toFixed(1));
    c?.setAttribute('x2', xx.toFixed(1));
    c?.setAttribute('visibility', 'visible');
    tooltip.textContent = `${fmtTime(anchor)} · ${bits.join(' · ')}`;
    tooltip.hidden = false;
    const px = (xx / W) * rect.width;
    tooltip.style.top = '24px';
    tooltip.style.left = px < rect.width - 150 ? `${px + 10}px` : '';
    tooltip.style.right = px < rect.width - 150 ? '' : `${rect.width - px + 10}px`;
  });
  svg.addEventListener('pointerleave', hide);
}
