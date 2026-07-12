// M2.6 D14 — the timeline bar IS the overview chart: the full 8-day range as
// a strip colored by the default spot's forecast (palette = map legend), day
// ticks, a draggable playhead, keyboard access. It only *writes* the time
// store; the map, table and chart follow as subscribers (D12). The raster
// only covers the first ~18 h — the strip beyond that is dimmed and the map
// holds its last frame there (sub-label says so).

import { MS_TO_KT, colorForKt } from './palette.ts';
import {
  TZ,
  localMidnightAtOrBefore,
  nearestIdx,
  select,
  selectTime,
  selectedMs,
  subscribe,
  timeState,
} from './state.ts';
import type { SeriesPt } from './spots.ts';

interface Frame {
  fxx: number;
  validTime: string;
  file: string;
}

export interface TimelineApi {
  /** Feed the spot series once it loads — colors the strip. */
  setSeries(series: SeriesPt[]): void;
}

const DAY_MS = 86_400_000;

function fmtPlayhead(ms: number): string {
  // "Sun 2 PM" — local, terse; dates live on the day ticks
  return new Date(ms)
    .toLocaleString('en-US', { weekday: 'short', hour: 'numeric', timeZone: TZ })
    .replace(',', '');
}

function fmtDayTick(ms: number): string {
  // assemble by hand — locale skeletons put the day first ("12 Sun")
  const d = new Date(ms);
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
  const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: TZ });
  return `${wd} ${day}`.toUpperCase();
}

export function setupTimeline(cfg: { run: string; frames: Frame[] }): TimelineApi {
  const root = document.getElementById('timeline') as HTMLDivElement;
  const timeEl = document.getElementById('tl-time') as HTMLDivElement;
  const subEl = document.getElementById('tl-sub') as HTMLDivElement;

  const frameTimes = cfg.frames.map((f) => Date.parse(f.validTime));
  const lastFrameMs = frameTimes[frameTimes.length - 1];

  root.innerHTML =
    '<div id="tl-strip"></div>' +
    '<div id="tl-dim" title="map raster ends here"></div>' +
    '<div id="tl-days"></div>' +
    '<div id="tl-playhead"><div id="tl-knob"></div></div>';
  const strip = document.getElementById('tl-strip') as HTMLDivElement;
  const dim = document.getElementById('tl-dim') as HTMLDivElement;
  const days = document.getElementById('tl-days') as HTMLDivElement;
  const playhead = document.getElementById('tl-playhead') as HTMLDivElement;

  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', 'forecast time');
  root.tabIndex = 0;

  let t0 = frameTimes[0];
  let t1 = lastFrameMs;
  const xPct = (ms: number) => ((ms - t0) / (t1 - t0)) * 100;

  let series: SeriesPt[] = [];

  function renderStrip(): void {
    if (series.length >= 2) {
      const stops = series.map(
        (p) =>
          `${colorForKt(p.spd * MS_TO_KT)} ${xPct(Date.parse(p.t)).toFixed(2)}%`,
      );
      strip.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    } else {
      strip.style.background = 'rgba(232, 237, 246, 0.16)';
    }
  }

  function renderScale(): void {
    // dim the part of the track the map raster can't show
    const dimFrom = Math.min(100, Math.max(0, xPct(lastFrameMs)));
    dim.style.left = `${dimFrom}%`;
    dim.style.display = dimFrom >= 100 ? 'none' : '';

    const cells: string[] = [];
    for (
      let d = localMidnightAtOrBefore(t0);
      d < t1;
      d = localMidnightAtOrBefore(d + DAY_MS + 6 * 3_600_000)
    ) {
      const left = Math.max(0, xPct(d));
      if (left >= 99) break;
      cells.push(
        `<span class="tl-day" style="left:${left.toFixed(2)}%">${fmtDayTick(
          d + 12 * 3_600_000, // label by the day's noon — immune to midnight edge
        )}</span>`,
      );
    }
    days.innerHTML = cells.join('');
  }

  function renderSelection(): void {
    const { times, selectedIdx } = timeState();
    const ms = selectedMs();
    if (Number.isNaN(ms)) return;
    playhead.style.left = `${Math.min(100, Math.max(0, xPct(ms)))}%`;
    timeEl.textContent = fmtPlayhead(ms);

    const fi = nearestIdx(frameTimes, ms);
    const fxx = String(cfg.frames[fi].fxx).padStart(2, '0');
    const beyond = ms > lastFrameMs;
    subEl.textContent =
      `HRRR ${cfg.run.slice(11, 13)}Z f${fxx}` + (beyond ? ' · map ≤ +18 h' : '');
    subEl.classList.toggle('tl-beyond', beyond);

    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', String(Math.max(0, times.length - 1)));
    root.setAttribute('aria-valuenow', String(selectedIdx));
    root.setAttribute('aria-valuetext', fmtPlayhead(ms));
  }

  // pointer: tap or drag anywhere on the bar
  const toTime = (clientX: number): number => {
    const r = root.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return t0 + frac * (t1 - t0);
  };
  let dragging = false;
  root.addEventListener('pointerdown', (ev) => {
    dragging = true;
    selectTime(toTime(ev.clientX));
    try {
      root.setPointerCapture(ev.pointerId);
    } catch {
      // synthetic pointers (tests) and already-released pointers can't be
      // captured — selection above already happened, drag just won't track
    }
  });
  root.addEventListener('pointermove', (ev) => {
    if (dragging) selectTime(toTime(ev.clientX));
  });
  const stopDrag = () => {
    dragging = false;
  };
  root.addEventListener('pointerup', stopDrag);
  root.addEventListener('pointercancel', stopDrag);

  root.addEventListener('keydown', (ev) => {
    const { times, selectedIdx } = timeState();
    if (times.length === 0) return;
    if (ev.key === 'ArrowLeft') select(selectedIdx - 1);
    else if (ev.key === 'ArrowRight') select(selectedIdx + 1);
    else if (ev.key === 'Home') select(0);
    else if (ev.key === 'End') select(times.length - 1);
    else return;
    ev.preventDefault();
  });

  let lastTimes: readonly number[] | null = null;
  subscribe((s) => {
    if (s.times !== lastTimes) {
      // range grew (series merged in) — rebuild the geometry-dependent bits
      lastTimes = s.times;
      if (s.times.length > 0) {
        t0 = s.times[0];
        t1 = s.times[s.times.length - 1];
      }
      renderStrip();
      renderScale();
    }
    renderSelection();
  });

  renderStrip();
  renderScale();
  renderSelection();

  return {
    setSeries(sr: SeriesPt[]): void {
      series = sr;
      renderStrip();
    },
  };
}
