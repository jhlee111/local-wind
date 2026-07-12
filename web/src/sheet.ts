// M2.6 D13 — mobile bottom sheet (windy.app pattern). Pure presentation
// layer over #spot-panel: below 768px the panel docks to the bottom edge
// with three snap states — peek (name + now line), half (adds the week
// table = the mobile time navigator), full (adds the detail chart). One
// pointer handler on the grip, no library. Desktop is untouched (the
// sheet-* classes only mean something inside the mobile media query).

export type SheetState = 'peek' | 'half' | 'full';

const MOBILE = '(max-width: 767px)';

interface SheetHook {
  ensureVisible(): void;
}

let hook: SheetHook | null = null;

/** A peeked sheet pops to half when the panel (re)opens with new content. */
export function sheetEnsureVisible(): void {
  hook?.ensureVisible();
}

export function setupSheet(panel: HTMLDivElement, grip: HTMLElement): void {
  let state: SheetState = 'half';
  const mobile = () => window.matchMedia(MOBILE).matches;

  const apply = (s: SheetState): void => {
    state = s;
    panel.classList.remove('sheet-peek', 'sheet-half', 'sheet-full');
    panel.classList.add(`sheet-${s}`);
  };
  apply('half');

  const snapHeights = (): Record<SheetState, number> => ({
    peek: 88,
    half: Math.min(330, window.innerHeight * 0.5),
    full: window.innerHeight * 0.86,
  });

  const cycle = (): void =>
    apply(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'peek');

  let startY = 0;
  let startH = 0;
  let dragging = false;

  grip.addEventListener('pointerdown', (ev) => {
    if (!mobile()) return;
    dragging = true;
    startY = ev.clientY;
    startH = panel.offsetHeight;
    panel.classList.add('sheet-dragging');
    try {
      grip.setPointerCapture(ev.pointerId);
    } catch {
      // synthetic pointers can't be captured — drag just won't track
    }
  });
  grip.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const h = Math.min(
      window.innerHeight * 0.9,
      Math.max(64, startH + startY - ev.clientY),
    );
    panel.style.height = `${h}px`;
  });
  const settle = (ev: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('sheet-dragging');
    panel.style.height = '';
    if (Math.abs(ev.clientY - startY) < 6) {
      cycle(); // a tap, not a drag
      return;
    }
    const h = startH + startY - ev.clientY;
    const hs = snapHeights();
    const nearest = (Object.keys(hs) as SheetState[]).reduce((a, b) =>
      Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a,
    );
    apply(nearest);
  };
  grip.addEventListener('pointerup', settle);
  grip.addEventListener('pointercancel', settle);

  // header tap toggles too (design: drag the handle *or* tap the header) —
  // but not on the close button
  const head = document.getElementById('sp-head');
  head?.addEventListener('click', (ev) => {
    if (!mobile()) return;
    if ((ev.target as HTMLElement).closest('#sp-close')) return;
    cycle();
  });

  hook = {
    ensureVisible(): void {
      if (mobile() && state === 'peek') apply('half');
    },
  };
}
