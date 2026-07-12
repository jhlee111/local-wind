import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  ImageType,
  ParticleLayer,
  loadTextureData,
  type TextureData,
} from 'weatherlayers-gl';

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

async function init(): Promise<void> {
  let manifest: Manifest;
  try {
    const res = await fetch('/data/wind.json');
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
          color: [30, 48, 80, 255],
          opacity: 0.9,
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
  map.on('load', () => void setFrame(0));
}

void init();
