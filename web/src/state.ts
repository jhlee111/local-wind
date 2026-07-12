// M2.6 D12 — single app-wide time state. Every time control (map raster,
// timeline scrubber, week-table highlight, chart cursor) is a *view* of the
// one selected instant here; none of them talk to each other directly.

/** Display timezone for every user-facing time label. */
export const TZ = 'America/Los_Angeles';

/** Local-TZ calendar-day key, e.g. "2026-07-12". */
export function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Ms of the local-TZ midnight at or before `ms` (DST-safe via probing). */
export function localMidnightAtOrBefore(ms: number): number {
  const key = dayKey(ms);
  // walk back in hour steps until the local day changes, then snap to hour
  let t = ms;
  while (dayKey(t - 3_600_000) === key) t -= 3_600_000;
  return Math.floor(t / 3_600_000) * 3_600_000;
}

export interface TimeState {
  /** Selectable instants, epoch ms, sorted ascending, unique. */
  times: number[];
  /** Index into `times`. */
  selectedIdx: number;
}

type Listener = (s: Readonly<TimeState>) => void;

const state: TimeState = { times: [], selectedIdx: 0 };
const listeners = new Set<Listener>();

function publish(): void {
  for (const fn of listeners) fn(state);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function timeState(): Readonly<TimeState> {
  return state;
}

/** Currently selected instant (epoch ms), NaN before initTimes. */
export function selectedMs(): number {
  return state.times.length > 0 ? state.times[state.selectedIdx] : Number.NaN;
}

/** Index of the instant nearest to `ms` in a sorted array (binary search). */
export function nearestIdx(times: readonly number[], ms: number): number {
  if (times.length === 0) return 0;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < ms) lo = mid + 1;
    else hi = mid;
  }
  // times[lo] is the first >= ms; its predecessor may be closer
  if (lo > 0 && Math.abs(times[lo - 1] - ms) <= Math.abs(times[lo] - ms)) {
    return lo - 1;
  }
  return lo;
}

/**
 * (Re)set the selectable instants — e.g. raster frame times first, extended
 * with the 8-day spot series once it loads. Keeps the currently selected
 * instant (nearest match) and publishes so range views can redraw.
 */
export function initTimes(times: number[]): void {
  const sorted = [...new Set(times)].sort((a, b) => a - b);
  const keepMs = selectedMs();
  state.times = sorted;
  state.selectedIdx = Number.isNaN(keepMs) ? 0 : nearestIdx(sorted, keepMs);
  publish();
}

/** Add selectable instants (e.g. an ad-hoc point's series) — keeps T. */
export function extendTimes(extra: number[]): void {
  if (extra.length === 0) return;
  initTimes([...state.times, ...extra]);
}

export function select(idx: number): void {
  if (state.times.length === 0) return;
  const clamped = Math.max(0, Math.min(state.times.length - 1, Math.round(idx)));
  if (clamped === state.selectedIdx) return;
  state.selectedIdx = clamped;
  publish();
}

/** Select the instant nearest to `ms`. */
export function selectTime(ms: number): void {
  select(nearestIdx(state.times, ms));
}
