import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  ImageType,
  ParticleLayer,
  RasterLayer,
  loadTextureData,
  type TextureData,
} from 'weatherlayers-gl';
import {
  LEGEND_MAX_KT,
  LEGEND_TICKS_KT,
  WIND_PALETTE,
  legendGradient,
} from './palette.ts';

interface Frame {
  fxx: number;
  validTime: string;
  file: string;
}

interface Manifest {
  bounds: [number, number, number, number];
  unscale: [number, number];
  run: string;
  model: string;
  frames: Frame[];
}

const frameLabel = document.getElementById('frame-label') as HTMLDivElement;
const slider = document.getElementById('frame-slider') as HTMLInputElement;

function buildLegend(): void {
  (document.getElementById('legend-bar') as HTMLDivElement).style.background =
    legendGradient();
  const ticks = document.getElementById('legend-ticks') as HTMLDivElement;
  ticks.innerHTML = '';
  for (const kt of LEGEND_TICKS_KT) {
    const s = document.createElement('span');
    s.textContent = String(kt);
    s.style.left = `${(kt / LEGEND_MAX_KT) * 100}%`;
    ticks.appendChild(s);
  }
}

async function init(): Promise<void> {
  buildLegend(); // static (palette only) — show it regardless of data/basemap

  let manifest: Manifest;
  try {
    const res = await fetch('/data/wind.json', {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    manifest = (await res.json()) as Manifest;
  } catch {
    frameLabel.textContent =
      'no wind data — run: uv run --project pipeline python -m localwind.bake';
    return;
  }

  // Plain-background style used when the basemap host is unreachable
  // (offline dev, blocked origin) — wind layer must not die with the basemap.
  const fallbackStyle: maplibregl.StyleSpecification = {
    version: 8,
    name: 'fallback',
    sources: {},
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#dfe7ee' } },
    ],
  };

  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [-118.4, 33.72],
    zoom: 9.2,
  });

  let usedFallback = false;
  const fallBack = () => {
    if (!usedFallback && !map.isStyleLoaded()) {
      usedFallback = true;
      map.setStyle(fallbackStyle);
    }
  };
  map.on('error', fallBack); // style fetch failed
  setTimeout(fallBack, 6000); // ...or hung (blocked origin without an error event)

  const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);

  const textures = new Map<number, TextureData>();
  async function texture(i: number): Promise<TextureData> {
    let t = textures.get(i);
    if (!t) {
      t = await loadTextureData(`/data/${manifest.frames[i].file}`);
      textures.set(i, t);
    }
    return t;
  }

  async function setFrame(i: number): Promise<void> {
    const frame = manifest.frames[i];
    const image = await texture(i);
    overlay.setProps({
      layers: [
        new RasterLayer({
          id: 'wind-speed',
          image,
          imageType: ImageType.VECTOR,
          imageUnscale: manifest.unscale,
          bounds: manifest.bounds,
          palette: WIND_PALETTE,
          opacity: 0.55,
        }),
        new ParticleLayer({
          id: 'wind-particles',
          image,
          imageType: ImageType.VECTOR,
          imageUnscale: manifest.unscale,
          bounds: manifest.bounds,
          numParticles: 4000,
          maxAge: 25,
          speedFactor: 8,
          width: 1.6,
          color: [20, 24, 40, 255],
          opacity: 0.8,
        }),
      ],
    });
    const valid = new Date(frame.validTime);
    const local = valid.toLocaleString('en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
      timeZoneName: 'short',
    });
    const fxx = String(frame.fxx).padStart(2, '0');
    frameLabel.textContent = `${local} · HRRR ${manifest.run.slice(11, 13)}Z f${fxx}`;
  }

  slider.max = String(manifest.frames.length - 1);
  slider.addEventListener('input', () => void setFrame(Number(slider.value)));

  // First render must NOT depend on the basemap: deck.gl renders on its own,
  // and 'load' never fires if the basemap host is blocked/unreachable. Fire on
  // whichever comes first — already-loaded, load, style.load, or a timeout.
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    void setFrame(0);
  };
  if (map.loaded()) start();
  map.on('load', start);
  map.on('style.load', start);
  setTimeout(start, 6500);
}

void init();
