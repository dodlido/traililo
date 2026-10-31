// "Play the journey": the trip as a film. A 3D satellite map travels the real roads, a glowing trail is drawn behind, and at
// every stop the camera slows down while the pictures from that moment and the day's own words appear. Pictures taken on the
// road pop up as you pass them. All of it is a function of the clock (film.ts), so it can be paused, scrubbed and replayed.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import type { Trip } from './model.ts';
import { buildFilm, headingAt, kmBetween, labelOfMode, pathUpTo, pointAt, sceneAt, type Film, type LngLat, type Mode, type MoveScene, type Scene, type StopScene } from './film.ts';
import { CATS, FERRY, PLANE, glyphSvg } from './mapkit.ts';
import { connectDrive, driveAvailable, driveConnected, pictureSrc } from './drive.ts';
import { Icon } from './Icon.tsx';
import { Pic } from './Pic.tsx';
import { countryName, longDate, monthShort, dayOfMonth, shortDate, weekday } from './derive.ts';
import type { Feature, FeatureCollection, LineString } from 'geojson';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const att = 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: { type: 'raster', tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 17, attribution: att },
    names: { type: 'raster', tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 17 },
    dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Elevation: Mapzen, NASADEM, SRTM' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0c161a' } },
    { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.92, 'raster-contrast': 0.08, 'raster-saturation': 0.05 } },
    { id: 'names', type: 'raster', source: 'names', paint: { 'raster-opacity': 0.75 } },
  ],
};

const CREDIT = 'Map imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community. Elevation: Mapzen, NASADEM, SRTM. Roads and ferry lines: OpenStreetMap contributors.';
const GLOW = '#ffb454';
const BERRY = '#b9a8ff';
const SEA = '#6cc4ff';

interface Cam {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const sm = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** Slow in, steady, slow out. */
const ease = (u: number) => u * 0.4 + sm(u) * 0.6;
const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const num = (n: number) => n.toLocaleString('en-GB');

const MR = Math.PI / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * MR) / 2));
/** The zoom at which the box fits a pixel area (the map's world is 512 pixels wide at zoom 0), and the middle of the box. */
function fitBox(b: [LngLat, LngLat], w: number, h: number): { lng: number; lat: number; zoom: number } {
  const fx = Math.max((b[1][0] - b[0][0]) / 360, 1e-7);
  const fy = Math.max((mercY(b[1][1]) - mercY(b[0][1])) / (2 * Math.PI), 1e-7);
  const zoom = Math.log2(Math.min(w / (fx * 512), h / (fy * 512)));
  const my = (mercY(b[0][1]) + mercY(b[1][1])) / 2;
  return { lng: (b[0][0] + b[1][0]) / 2, lat: (Math.atan(Math.sinh(my)) / MR), zoom: clamp(zoom, 1.5, 13) };
}

const prefersReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const emptyLines = (): FeatureCollection<LineString> => ({ type: 'FeatureCollection', features: [] });
const line = (coords: [number, number][], props: Record<string, unknown> = {}): Feature<LineString> => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });

/** An arrow that points the way the camera is looking, like a satnav. */
const CHEVRON = 'M12 2.5 19.5 21 12 16.8 4.5 21z';
function roverSvg(mode: Mode): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(NS, 'path');
  const plane = mode === 'flight';
  p.setAttribute('d', plane ? PLANE : mode === 'ferry' ? FERRY : CHEVRON);
  p.setAttribute('fill', plane || (mode !== 'ferry') ? 'currentColor' : 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', plane ? '0.6' : '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

interface Pin {
  el: HTMLElement;
  marker: maplibregl.Marker;
  i: number;
  on: boolean;
  img?: HTMLImageElement;
  loaded: boolean;
  photoId?: string;
}

export function RecapFilm({ trip, title, upTo, onClose }: { trip: Trip; title: string; upTo: string; onClose: () => void }) {
  const [, tick] = useState(0);
  const [ready, setReady] = useState(driveConnected());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState({ idx: 0, ph: 0, shots: '' });
  const [mapFailed, setMapFailed] = useState(false);
  const [credits, setCredits] = useState(false);

  const hasPhotos = useMemo(() => trip.days.some((d) => d.date <= upTo && d.drivePhotos?.length), [trip, upTo]);
  const film = useMemo(() => buildFilm(trip, upTo, { photos: ready }), [trip, upTo, ready]);

  const box = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const filmRef = useRef<Film>(film);
  const t = useRef(0);
  const playRef = useRef(false);
  const speedRef = useRef(1);
  const idxRef = useRef(0);
  const viewRef = useRef(view);
  const camRef = useRef<Cam | null>(null);
  const snap = useRef(true);
  const dirty = useRef(true);
  const pins = useRef<Pin[]>([]);
  const rover = useRef<{ marker: maplibregl.Marker; el: HTMLElement; mode: string } | null>(null);
  const loaded = useRef(false);
  const overview = useRef<Cam | null>(null);
  const reducedRef = useRef(prefersReduced());
  const hud = useRef<{ km: HTMLElement | null; hike: HTMLElement | null; pics: HTMLElement | null; bar: HTMLElement | null; time: HTMLElement | null; day: HTMLElement | null }>({ km: null, hike: null, pics: null, bar: null, time: null, day: null });
  const warmed = useRef(new Set<string>());
  const pastIdx = useRef(-1);
  const trailDirty = useRef(true);

  filmRef.current = film;
  playRef.current = playing;
  speedRef.current = speed;

  // ---------------------------------------------------------------- the map
  useEffect(() => {
    if (!box.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({ container: box.current, style: STYLE, center: [35, 32], zoom: 5, maxPitch: 80, minZoom: 1, maxZoom: 17.5, attributionControl: false, dragRotate: false, interactive: false, pitch: 0, fadeDuration: 150 });
    } catch {
      setMapFailed(true);
      return;
    }
    mapRef.current = map;
    if (location.search.includes('debugmap')) (window as unknown as { __tlfilm: unknown }).__tlfilm = map;
    map.on('load', () => {
      try {
        map.setTerrain({ source: 'dem', exaggeration: 1.45 });
      } catch {
        /* flat map */
      }
      try {
        map.setSky({ 'sky-color': '#5d86c7', 'horizon-color': '#f4cfa6', 'fog-color': '#cfd9e0', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.15, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 1, 13, 0.15] });
      } catch {
        /* no sky */
      }
      const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
      const modeColor: maplibregl.ExpressionSpecification = ['match', ['get', 'mode'], 'flight', BERRY, 'ferry', SEA, GLOW];
      map.addSource('ghost', { type: 'geojson', data: emptyLines() });
      map.addSource('past', { type: 'geojson', data: emptyLines() });
      map.addSource('now', { type: 'geojson', data: emptyLines() });
      map.addLayer({ id: 'ghost', type: 'line', source: 'ghost', layout: round, paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.6, 12, 2], 'line-dasharray': [0.4, 2.2] } });
      for (const src of ['past', 'now']) {
        map.addLayer({ id: `${src}-glow`, type: 'line', source: src, layout: round, paint: { 'line-color': modeColor, 'line-width': 15, 'line-blur': 9, 'line-opacity': src === 'now' ? 0.75 : 0.45 } });
        map.addLayer({ id: `${src}-line`, type: 'line', source: src, layout: round, paint: { 'line-color': modeColor, 'line-width': 5 } });
        map.addLayer({ id: `${src}-core`, type: 'line', source: src, layout: round, paint: { 'line-color': '#fff6e0', 'line-width': 1.8, 'line-opacity': 0.95 } });
      }
      // MapLibre moves the outer element around; the look lives on the inner one
      const wrap = document.createElement('div');
      const el = document.createElement('div');
      el.className = 'film-rover';
      wrap.append(el);
      rover.current = { marker: new maplibregl.Marker({ element: wrap, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat([35, 32]).addTo(map), el, mode: '' };
      loaded.current = true;
      setupFilm();
      dirty.current = true;
    });
    return () => {
      loaded.current = false;
      map.remove();
      mapRef.current = null;
      pins.current = [];
      rover.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Puts the film's roads and pins on the map. Runs when the map has loaded and again whenever the film is rebuilt. */
  const setupFilm = useCallback(() => {
    const map = mapRef.current;
    const f = filmRef.current;
    if (!map || !loaded.current) return;
    (map.getSource('ghost') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: f.roads.map((r) => line(r.path)) });
    for (const p of pins.current) p.marker.remove();
    pins.current = [];
    pastIdx.current = -1;
    trailDirty.current = true;
    f.scenes.forEach((s, i) => {
      if (s.kind !== 'stop' && !(s.kind === 'night' && s.photos.length)) return;
      const wrap = document.createElement('div');
      const el = document.createElement('div');
      el.className = 'film-pin';
      wrap.append(el);
      const cover = s.photos[Math.floor((s.photos.length - 1) / 2)];
      const marker = new maplibregl.Marker({ element: wrap, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat([s.at.lon, s.at.lat]).addTo(map);
      const pin: Pin = { el, marker, i, on: false, loaded: false, photoId: cover?.id };
      if (cover) {
        const img = document.createElement('img');
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        el.append(img);
        pin.img = img;
        el.classList.add('has-photo');
      } else {
        el.style.setProperty('--pin', CATS[s.cat].color);
        el.append(glyphSvg(s.cat));
      }
      pins.current.push(pin);
    });
    // the whole route, framed, for the title and the end
    if (f.bounds) {
      const w = box.current?.clientWidth ?? 390;
      const h = box.current?.clientHeight ?? 700;
      const fb = fitBox(f.bounds, w >= 860 ? w * 0.5 : w * 0.8, h * (w >= 860 ? 0.6 : 0.46));
      overview.current = { lng: fb.lng, lat: fb.lat, zoom: fb.zoom, bearing: 0, pitch: 0, top: 0, bottom: 0, left: 0, right: 0 };
    } else overview.current = null;
    snap.current = true;
    idxRef.current = 0;
    dirty.current = true;
  }, []);

  useEffect(() => {
    // a rebuilt film (after signing in to Google) starts again from the beginning
    t.current = 0;
    setupFilm();
    setView({ idx: 0, ph: 0, shots: '' });
    viewRef.current = { idx: 0, ph: 0, shots: '' };
  }, [film, setupFilm]);

  // ---------------------------------------------------------------- the camera for each moment
  const cameraFor = (f: Film, s: Scene, lt: number, W: number, H: number): Cam => {
    const reduced = reducedRef.current;
    const wide = W >= 860;
    const p = clamp(lt / s.dur, 0, 1);
    const ov = overview.current ?? { lng: 35, lat: 32, zoom: 7, bearing: 0, pitch: 0, top: 0, bottom: 0, left: 0, right: 0 };
    const pad = (card: 'none' | 'small' | 'big') => {
      const top = 70;
      if (wide) return { top, bottom: card === 'none' ? 110 : 120, left: card === 'big' ? Math.min(560, W * 0.42) : card === 'small' ? 120 : 60, right: 60 };
      return { top, bottom: card === 'big' ? H * 0.52 : card === 'small' ? H * 0.3 : H * 0.2, left: 20, right: 20 };
    };
    const orbit = (base: number, deg: number) => (reduced ? 0 : base + deg * p);
    switch (s.kind) {
      case 'title':
        return { ...ov, pitch: reduced ? 0 : 36, bearing: orbit(-14, 12), zoom: ov.zoom - 0.35, ...pad('none'), bottom: wide ? 110 : H * 0.22 };
      case 'end':
        return { ...ov, pitch: reduced ? 0 : 28, bearing: orbit(0, -10), zoom: ov.zoom - 0.5, ...pad('none'), bottom: wide ? 120 : H * 0.46, right: wide ? 60 : 20 };
      case 'day':
        return { lng: s.at.lon, lat: s.at.lat, zoom: 13.4, pitch: reduced ? 0 : 58, bearing: orbit(s.heading - 20, 20), ...pad('none') };
      case 'move': {
        const total = s.cum[s.cum.length - 1];
        const u = clamp(lt / s.dur, 0, 1);
        const d = total * ease(u);
        const [lng, lat] = pointAt(s.path, s.cum, d);
        const cruise = clamp(12.7 - 0.8 * Math.log2(Math.max(total, 1) / 6), 5.8, 13.4);
        const ends = Math.max(1 - sm(u / 0.22), sm((u - 0.78) / 0.22));
        const flight = s.mode === 'flight';
        return {
          lng,
          lat,
          zoom: cruise + (14.1 - cruise) * ends * 0.85,
          pitch: reduced ? 0 : flight ? 46 : 58,
          bearing: reduced ? 0 : headingAt(s.path, s.cum, d, Math.max(0.35, total * 0.07)),
          ...pad('none'),
          ...(s.shots.some((x) => lt >= x.at * s.dur && lt < x.at * s.dur + 3000) ? { bottom: wide ? 120 : H * 0.34 } : {}),
        };
      }
      default: {
        const card = s.photos.length || s.text ? 'big' : 'small';
        return { lng: s.at.lon, lat: s.at.lat, zoom: s.wide ? 13.6 : 14.7, pitch: reduced ? 0 : 62, bearing: orbit(s.heading, 24), ...pad(card) };
      }
    }
  };

  // ---------------------------------------------------------------- the clock
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last);
      last = now;
      const map = mapRef.current;
      const f = filmRef.current;
      if (!map || !loaded.current || !f.scenes.length) return;
      if (playRef.current) {
        t.current = Math.min(f.total, t.current + dt * speedRef.current);
        if (t.current >= f.total) {
          playRef.current = false;
          setPlaying(false);
        }
        dirty.current = true;
        trailDirty.current = true;
      }
      const W = box.current?.clientWidth ?? 390;
      const H = box.current?.clientHeight ?? 700;
      const idx = sceneAt(f, Math.min(t.current, f.total - 1), idxRef.current);
      const s = f.scenes[idx];
      const lt = clamp(t.current - s.start, 0, s.dur);
      const p = lt / s.dur;

      // ----- camera, eased toward where this moment wants it -----
      const tg = cameraFor(f, s, lt, W, H);
      let c = camRef.current;
      if (!c || snap.current) {
        c = { ...tg };
        snap.current = false;
        dirty.current = true;
      } else {
        const k = (hz: number) => 1 - Math.exp((-hz * dt) / 1000);
        const moving = s.kind === 'move';
        // a long way to go: pull back on the way, so the map is never blank
        const dist = kmBetween([c.lng, c.lat], [tg.lng, tg.lat]);
        const fit = Math.log2((78.27 * Math.cos((tg.lat * Math.PI) / 180) * W) / Math.max(1, dist * 1.6));
        const zoomGoal = Math.min(tg.zoom, fit);
        c = {
          lng: c.lng + (tg.lng - c.lng) * k(moving ? 7 : 2.6),
          lat: c.lat + (tg.lat - c.lat) * k(moving ? 7 : 2.6),
          zoom: c.zoom + (zoomGoal - c.zoom) * k(1.9),
          bearing: c.bearing + turn(c.bearing, tg.bearing) * k(moving ? 2.2 : 1.7),
          pitch: c.pitch + (tg.pitch - c.pitch) * k(1.8),
          top: c.top + (tg.top - c.top) * k(3),
          bottom: c.bottom + (tg.bottom - c.bottom) * k(3),
          left: c.left + (tg.left - c.left) * k(3),
          right: c.right + (tg.right - c.right) * k(3),
        };
        const old = camRef.current!;
        if (Math.abs(c.lng - old.lng) + Math.abs(c.lat - old.lat) + Math.abs(c.zoom - old.zoom) + Math.abs(c.bearing - old.bearing) + Math.abs(c.pitch - old.pitch) + Math.abs(c.bottom - old.bottom) + Math.abs(c.left - old.left) > 1e-5) dirty.current = true;
      }
      camRef.current = c;
      if (dirty.current) {
        map.jumpTo({ center: [c.lng, c.lat], zoom: c.zoom, bearing: c.bearing, pitch: c.pitch, padding: { top: c.top, bottom: c.bottom, left: c.left, right: c.right } });
      }

      // ----- the trail and the traveller -----
      const r = rover.current;
      if (idx !== pastIdx.current) {
        pastIdx.current = idx;
        const feats: Feature<LineString>[] = [];
        // the title shows the whole road glowing; it is rubbed out as the film starts and drawn again as it is travelled
        const upto = s.kind === 'title' ? f.scenes.length : idx;
        for (let i = 0; i < upto; i++) {
          const q = f.scenes[i];
          if (q.kind === 'move') feats.push(line(q.path, { mode: q.mode }));
        }
        (map.getSource('past') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats });
        dirty.current = true;
      }
      const nowSrc = map.getSource('now') as maplibregl.GeoJSONSource | undefined;
      let at: [number, number] | null = null;
      if (s.kind === 'move') {
        const total = s.cum[s.cum.length - 1];
        const d = total * ease(p);
        at = pointAt(s.path, s.cum, d);
        if (trailDirty.current) nowSrc?.setData({ type: 'FeatureCollection', features: [line(pathUpTo(s.path, s.cum, d), { mode: s.mode })] });
      } else {
        if (trailDirty.current) nowSrc?.setData(emptyLines());
        if (s.kind === 'stop' || s.kind === 'night' || s.kind === 'day') at = [s.at.lon, s.at.lat];
        else if (s.kind === 'end') {
          const last = [...f.scenes].reverse().find((q) => q.kind === 'night' || q.kind === 'stop');
          at = last && (last.kind === 'night' || last.kind === 'stop') ? [last.at.lon, last.at.lat] : null;
        } else {
          const first = f.scenes.find((q) => q.kind === 'day');
          at = first && first.kind === 'day' ? [first.at.lon, first.at.lat] : null;
        }
      }
      if (r && at) {
        r.marker.setLngLat(at);
        const m = s.kind === 'move' ? s.mode : 'still';
        if (r.mode !== m) {
          r.mode = m;
          r.el.replaceChildren(...(m === 'still' ? [] : [roverSvg(m as Mode)]));
          r.el.classList.toggle('is-still', m === 'still');
          r.el.classList.toggle('is-air', m === 'flight');
        }
        r.el.style.opacity = s.kind === 'title' || s.kind === 'end' ? '0' : '1';
      }

      // ----- the pins left behind -----
      if (idx !== viewRef.current.idx || dirty.current) {
        for (const pin of pins.current) {
          const on = pin.i < idx || (pin.i === idx && p > 0.3);
          if (on !== pin.on) {
            pin.on = on;
            pin.el.classList.toggle('on', on);
            if (on && pin.img && pin.photoId && !pin.loaded) {
              pin.loaded = true;
              pictureSrc(pin.photoId, 200).then(
                (u) => pin.img && (pin.img.src = u),
                () => pin.el.classList.remove('has-photo'),
              );
            }
          }
        }
      }

      // ----- numbers along the top, written straight into the page -----
      const share = s.kind === 'move' ? ease(p) : p;
      const h = hud.current;
      if (h.km) h.km.textContent = num(Math.round(s.odo.km + s.add.km * share));
      if (h.hike) h.hike.textContent = (Math.round((s.odo.hike + s.add.hike * share) * 10) / 10).toString();
      if (h.pics) h.pics.textContent = num(Math.round(s.odo.photos + s.add.photos * share));
      if (h.bar) h.bar.style.transform = `scaleX(${clamp(t.current / f.total, 0, 1)})`;
      if (h.time) h.time.textContent = `${mmss(t.current)} / ${mmss(f.total)}`;

      // ----- what the page around it shows: only when it changes -----
      let ph = 0;
      let shots = '';
      if (s.kind === 'stop' || s.kind === 'night') {
        const n = s.photos.length;
        if (n) ph = clamp(Math.floor(((lt - s.dur * 0.04) / (s.dur * 0.9)) * n), 0, n - 1);
      } else if (s.kind === 'move') {
        shots = s.shots
          .map((x, i) => (lt >= x.at * s.dur && lt < x.at * s.dur + 3000 ? i : -1))
          .filter((i) => i >= 0)
          .join(',');
      }
      const v = viewRef.current;
      if (v.idx !== idx || v.ph !== ph || v.shots !== shots) {
        const nv = { idx, ph, shots };
        viewRef.current = nv;
        setView(nv);
      }
      idxRef.current = idx;
      dirty.current = false;
      trailDirty.current = false;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pictures for what is coming, loaded before they are needed
  useEffect(() => {
    if (!ready) return;
    for (let i = view.idx; i < Math.min(film.scenes.length, view.idx + 4); i++) {
      const s = film.scenes[i];
      const list = s.kind === 'move' ? s.shots.map((x) => x.photo) : s.kind === 'stop' || s.kind === 'night' ? s.photos : [];
      for (const p of list) {
        if (warmed.current.has(p.id)) continue;
        warmed.current.add(p.id);
        pictureSrc(p.id, s.kind === 'move' ? 500 : 1100).then(
          (u) => {
            const im = new Image();
            im.referrerPolicy = 'no-referrer';
            im.src = u;
          },
          () => {},
        );
      }
    }
  }, [view.idx, film, ready]);

  // ---------------------------------------------------------------- controls
  const seek = useCallback((ms: number) => {
    t.current = clamp(ms, 0, filmRef.current.total);
    snap.current = true;
    dirty.current = true;
    trailDirty.current = true;
  }, []);
  const play = useCallback(() => {
    if (t.current >= filmRef.current.total - 50) seek(0);
    setStarted(true);
    setPlaying(true);
  }, [seek]);
  const toggle = useCallback(() => (playRef.current ? setPlaying(false) : play()), [play]);
  useEffect(() => {
    if (location.search.includes('debugmap')) (window as unknown as { __filmCtl: unknown }).__filmCtl = { seek, play, pause: () => setPlaying(false), film, get t() { return t.current; } };
  }, [seek, play, film]);
  const jumpDay = useCallback(
    (dir: 1 | -1) => {
      const f = filmRef.current;
      const here = f.days.findIndex((d) => t.current >= d.start && t.current < d.end);
      const cur = here < 0 ? f.days.length - 1 : here;
      const goes = dir === 1 ? cur + 1 : t.current - (f.days[cur]?.start ?? 0) > 2500 ? cur : cur - 1;
      if (goes >= f.days.length) return seek(f.total - 1);
      if (goes < 0) return seek(0);
      seek(f.days[goes].start);
    },
    [seek],
  );
  const connect = async () => {
    setBusy(true);
    setErr('');
    try {
      await connectDrive();
      setReady(true);
      tick((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong with Google.');
    }
    setBusy(false);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') seek(t.current + 5000);
      else if (e.key === 'ArrowLeft') seek(t.current - 5000);
      else if (e.key === 'f' || e.key === 'F') void fullscreen();
    };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggle, seek, onClose]);

  // keep the screen awake while it plays
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    if (playing && 'wakeLock' in navigator) {
      (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen').then(
        (l) => (lock = l),
        () => {},
      );
    }
    return () => {
      void lock?.release().catch(() => {});
    };
  }, [playing]);

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen?.();
    } catch {
      /* not allowed here */
    }
  };

  const scrub = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(clamp((e.clientX - r.left) / r.width, 0, 1) * film.total);
  };
  const dragging = useRef(false);

  // ---------------------------------------------------------------- what is on screen
  const s = film.scenes[view.idx] ?? film.scenes[0];
  const day = s ? trip.days[s.day] : undefined;
  const dates = `${monthShort(trip.startDate)} ${dayOfMonth(trip.startDate)} to ${monthShort(trip.endDate)} ${dayOfMonth(trip.endDate)}, ${trip.endDate.slice(0, 4)}`;
  const needSignIn = driveAvailable() && !ready && hasPhotos;

  const card = (st: StopScene) => {
    const n = st.photos.length;
    return (
      <section className={`film-card${n ? ' has-photos' : ''}${st.text ? ' has-text' : ''}`} key={view.idx} style={{ ['--pin' as string]: CATS[st.cat].color, ['--slot' as string]: `${Math.round((st.dur * 0.9) / Math.max(1, n))}ms` }}>
        {n > 0 && (
          <div className="film-photos">
            {st.photos.map((p, i) => (
              <div key={p.id} className={i === view.ph ? 'on' : ''}>
                <Pic photo={p} ready={ready} size={1100} />
              </div>
            ))}
            {n > 1 && (
              <span className="film-dots" aria-hidden="true">
                {st.photos.map((p, i) => (
                  <i key={p.id} className={i === view.ph ? 'on' : i < view.ph ? 'done' : ''} />
                ))}
              </span>
            )}
          </div>
        )}
        <div className="film-cap">
          <span className="film-eyebrow">
            <Icon name={st.kind === 'night' ? 'bed' : st.cat === 'hike' ? 'hike' : st.cat === 'food' ? 'fork' : st.cat === 'hang' ? 'cocktail' : 'spark'} size={15} /> {st.eyebrow}
          </span>
          <h2 dir="auto">{st.title}</h2>
          {st.facts.length > 0 && (
            <p className="film-facts">
              {st.facts.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </p>
          )}
          {st.text && (
            <blockquote dir="auto">
              <span aria-hidden="true">“</span>
              {st.text}
            </blockquote>
          )}
        </div>
      </section>
    );
  };

  const move = s?.kind === 'move' ? (s as MoveScene) : null;
  const shotIdx = view.shots ? view.shots.split(',').map(Number) : [];

  return createPortal(
    <div ref={root} className={`film${playing ? '' : ' is-paused'}${started ? ' is-started' : ''} kind-${s?.kind ?? 'title'}`} role="dialog" aria-label={`${title}, the journey`} style={{ ['--speed' as string]: speed, ['--dur' as string]: `${s?.dur ?? 2000}ms` }}>
      <div className="film-map" ref={box} />
      <div className="film-shade" aria-hidden="true" />
      {mapFailed && (
        <div className="film-fail">
          <p>This browser cannot draw the 3D map, so the film cannot play here.</p>
        </div>
      )}

      <header className="film-top">
        <button type="button" className="film-btn" aria-label="Close the film" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
        {started && s && s.kind !== 'title' && (
          <div className="film-hud">
            <div className="film-day">
              <b>{s.kind === 'end' ? 'The end' : `Day ${s.day + 1}`}</b>
              {day && s.kind !== 'end' && (
                <span>
                  {weekday(day.date)} {shortDate(day.date)} · {day.region}
                </span>
              )}
            </div>
            <dl className="film-odo">
              <div>
                <dt ref={(el) => void (hud.current.km = el)}>0</dt>
                <dd>km travelled</dd>
              </div>
              {film.totals.hike > 0 && (
                <div>
                  <dt ref={(el) => void (hud.current.hike = el)}>0</dt>
                  <dd>km on foot</dd>
                </div>
              )}
              {film.totals.photos > 0 && (
                <div>
                  <dt ref={(el) => void (hud.current.pics = el)}>0</dt>
                  <dd>pictures</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </header>

      {/* ----- the scene's own words and pictures ----- */}
      {started && s?.kind === 'day' && (
        <div className="film-daycard" key={view.idx}>
          <span className="film-bigday">Day {s.n}</span>
          <b>{longDate(s.date)}</b>
          <span dir="auto">
            {s.region}
            {s.country ? ` · ${countryName[s.country]}` : ''}
          </span>
          <small>
            {s.n} of {s.total}
          </small>
        </div>
      )}
      {started && s && (s.kind === 'stop' || s.kind === 'night') && card(s)}
      {started && move && (
        <>
          <div className="film-move" key={`m${view.idx}`}>
            <Icon name={move.mode === 'flight' ? 'flight' : move.mode === 'ferry' ? 'ferry' : 'bus'} size={17} />
            <b>{labelOfMode(move.mode)}</b>
            <span dir="auto">
              {move.from} → {move.to}
            </span>
            <em>
              {Math.round(move.km)} km{move.mins ? ` · ${move.mins >= 60 ? `${Math.floor(move.mins / 60)} h ${move.mins % 60} min` : `${move.mins} min`}` : ''}
            </em>
          </div>
          {shotIdx.map((i, k) => (
            <figure className={`film-polaroid ${(i + k) % 2 ? 'r' : 'l'}`} key={`${view.idx}-${i}`} style={{ ['--tilt' as string]: `${((i * 7) % 9) - 4}deg` }}>
              <Pic photo={move.shots[i]?.photo} ready={ready} size={600} />
            </figure>
          ))}
        </>
      )}
      {s?.kind === 'end' && <EndCard film={film} trip={trip} title={title} onReplay={() => { seek(0); play(); }} onClose={onClose} />}

      {/* ----- before it starts ----- */}
      {(!started || s?.kind === 'title') && (
        <div className={`film-poster${started ? ' is-rolling' : ''}`} key={started ? 'roll' : 'poster'}>
          <p className="eyebrow">The journey</p>
          <h1 dir="auto">{title}</h1>
          <p className="film-sub">{dates}</p>
          {started ? null : film.empty ? (
            <p className="film-note">There is nothing to play yet. Add places with a spot on the map to the days and the film draws itself.</p>
          ) : (
            <>
              <button type="button" className="film-play" onClick={play} aria-label="Play the journey" autoFocus>
                <Icon name="play" size={34} />
              </button>
              <p className="film-len">{mmss(film.total)} · {film.days.length} {film.days.length === 1 ? 'day' : 'days'}</p>
              {needSignIn && (
                <button type="button" className="film-signin" disabled={busy} onClick={() => void connect()}>
                  <Icon name="image" size={17} /> {busy ? 'Connecting…' : 'Add my pictures (sign in with Google)'}
                </button>
              )}
              {err && <p role="status" className="hint">{err}</p>}
            </>
          )}
        </div>
      )}

      {!started && <p className="film-credit">{CREDIT}</p>}

      {/* ----- the controls ----- */}
      {started && (
        <footer className="film-controls">
          <div
            className="film-scrub"
            role="slider"
            aria-label="Position in the film"
            aria-valuemin={0}
            aria-valuemax={Math.round(film.total / 1000)}
            aria-valuenow={Math.round(t.current / 1000)}
            tabIndex={0}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              scrub(e);
            }}
            onPointerMove={(e) => dragging.current && scrub(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <span className="film-bar" ref={(el) => void (hud.current.bar = el)} />
            {film.days.slice(1).map((d) => (
              <i key={d.date} style={{ left: `${(d.start / film.total) * 100}%` }} title={`Day ${d.n}`} />
            ))}
          </div>
          {credits && <p className="film-credit is-open">{CREDIT}</p>}
          <div className="film-row">
            <button type="button" className="film-btn" aria-label="Previous day" onClick={() => jumpDay(-1)}>
              <span className="flip"><Icon name="skip" size={18} /></span>
            </button>
            <button type="button" className="film-btn big" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>
              <Icon name={playing ? 'pause' : 'play'} size={22} />
            </button>
            <button type="button" className="film-btn" aria-label="Next day" onClick={() => jumpDay(1)}>
              <Icon name="skip" size={18} />
            </button>
            <span className="film-time" ref={(el) => void (hud.current.time = el)}>0:00</span>
            <button type="button" className="film-speed" aria-label={`Speed ${speed}×, tap to change`} onClick={() => setSpeed((v) => (v === 1 ? 2 : v === 2 ? 4 : 1))}>
              {speed}×
            </button>
            <button type="button" className={`film-btn${credits ? ' is-on' : ''}`} aria-label="Map credits" aria-pressed={credits} onClick={() => setCredits((v) => !v)}>
              <span className="film-i">i</span>
            </button>
            {typeof document !== 'undefined' && document.fullscreenEnabled && (
              <button type="button" className="film-btn" aria-label="Full screen" onClick={() => void fullscreen()}>
                <Icon name="expand" size={18} />
              </button>
            )}
          </div>
        </footer>
      )}
    </div>,
    document.body,
  );
}

function Count({ to, ms = 1400, decimals = 0 }: { to: number; ms?: number; decimals?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const u = clamp((now - t0) / ms, 0, 1);
      setV(to * (1 - Math.pow(1 - u, 3)));
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{decimals ? v.toFixed(decimals) : num(Math.round(v))}</>;
}

function EndCard({ film, trip, title, onReplay, onClose }: { film: Film; trip: Trip; title: string; onReplay: () => void; onClose: () => void }) {
  const days = film.days.length;
  const places = new Set(trip.days.filter((d) => film.days.some((m) => m.date === d.date)).map((d) => d.region)).size;
  const tiles: { n: number; label: string; d?: number; unit?: string }[] = [
    { n: days, label: days === 1 ? 'day' : 'days' },
    { n: Math.round(film.totals.km), label: 'km travelled' },
    { n: film.totals.hike, label: 'km on foot', d: 1 },
    { n: film.totals.climb, label: 'metres climbed' },
    { n: film.totals.photos, label: 'pictures' },
    { n: places, label: places === 1 ? 'place' : 'places' },
  ].filter((x) => x.n > 0);
  return (
    <div className="film-end">
      <p className="eyebrow">That was</p>
      <h2 dir="auto">{title}</h2>
      <dl>
        {tiles.map((x, i) => (
          <div key={x.label} style={{ animationDelay: `${0.25 + i * 0.12}s` }}>
            <dt>
              <Count to={x.n} decimals={x.d} />
            </dt>
            <dd>{x.label}</dd>
          </div>
        ))}
      </dl>
      <div className="film-end-actions">
        <button type="button" className="add-btn" onClick={onReplay}>
          <Icon name="play" size={18} /> Watch again
        </button>
        <button type="button" className="chip" onClick={onClose}>
          Back to the recap
        </button>
      </div>
    </div>
  );
}
