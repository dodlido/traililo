// Route map, built on MapLibre GL. Dark raster basemap tiles load from CARTO when you are online; the route and
// pins are drawn from the trip data, so they still show without tiles. The map follows the day you are reading:
// the route fills in up to that day and the camera flies to it.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerSource from 'worker-text';
import type { Feature, FeatureCollection, LineString, MultiLineString, Point as GeoPoint } from 'geojson';
import type { CommuteEntry, Day, Entry, HikeEntry, Point, Poi, Trip } from './model.ts';
import { CATS, catOfEntry, glyphSvg, type Cat } from './mapkit.ts';
import { minutes } from './derive.ts';

export type Tracks = Record<string, { lines: number[][][]; km: number; name: string }>;
export interface Focus { id: string; n: number }

function factsOf(e: Entry): string {
  const bits: string[] = [];
  if (e.kind === 'hike') {
    const h = e as HikeEntry;
    if (h.distanceKm !== undefined) bits.push(`${Math.round(h.distanceKm * 10) / 10} km`);
    if (h.elevationGainM) bits.push(`+${h.elevationGainM.toLocaleString('en-GB')} m`);
    const d = minutes(h.durationMin);
    if (d) bits.push(d);
  } else if (e.kind === 'experience') {
    if (e.startTime) bits.push(e.startTime);
    const d = minutes(e.durationMin);
    if (d) bits.push(d);
  }
  return bits.join(' · ');
}

try {
  maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
} catch {
  /* falls back to MapLibre's own worker */
}

const ICE = '#dce9ea';
const FOG = '#8aa0a4';
const BERRY = '#9a8cf0';
const NIGHT = '#0b1418';
const AMBER = '#e6bd6e';
const CORAL = '#ff9a7a';
const MINT = '#7fd6c2';

type Mode = 'flight' | 'ferry' | 'drive' | 'trek' | 'scenic';
interface Seg { pts: Point[]; mode: Mode; day: number; name?: string }

const lngLat = (p: Point): [number, number] => [p.lon, p.lat];
const same = (a: Point, b: Point) => a.lat === b.lat && a.lon === b.lon;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function segmentsOf(trip: Trip): Seg[] {
  const days = trip.days;
  const segs: Seg[] = [];
  days.forEach((d, i) => {
    const mine = (trip.lines ?? []).filter((l) => l.date === d.date);
    for (const l of mine) segs.push({ pts: l.points, mode: l.mode, day: i, name: l.name });
    if (i === 0 || !d.point || mine.some((l) => l.replace)) return;
    const commute = d.entries.find((e): e is CommuteEntry => e.kind === 'commute');
    const legs = commute?.legs ?? [];
    if (legs.length > 1 && legs.every((l) => l.fromPoint && l.toPoint)) {
      for (const l of legs) segs.push({ pts: [l.fromPoint!, l.toPoint!], mode: l.mode === 'ferry' ? 'ferry' : 'drive', day: i });
      return;
    }
    const prev = days[i - 1].point;
    if (!prev || same(prev, d.point)) return;
    const m = legs[0]?.mode;
    const mode: Mode = m === 'flight' ? 'flight' : m === 'ferry' ? 'ferry' : m ? 'drive' : d.entries.some((e) => e.kind === 'hike') ? 'trek' : 'drive';
    segs.push({ pts: [prev, d.point], mode, day: i });
  });
  return segs;
}

/** A flight is drawn as a gentle arc instead of a straight line. */
function arc(a: Point, b: Point): [number, number][] {
  const mx = (a.lon + b.lon) / 2;
  const my = (a.lat + b.lat) / 2;
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const cx = mx - dy * 0.2;
  const cy = my + dx * 0.2;
  return Array.from({ length: 33 }, (_, i) => {
    const t = i / 32;
    const u = 1 - t;
    return [u * u * a.lon + 2 * u * t * cx + t * t * b.lon, u * u * a.lat + 2 * u * t * cy + t * t * b.lat];
  });
}

function routeData(segs: Seg[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: segs.map((s) => ({
      type: 'Feature',
      properties: { day: s.day, mode: s.mode, name: s.name ?? '' },
      geometry: { type: 'LineString', coordinates: s.mode === 'flight' ? arc(s.pts[0], s.pts[s.pts.length - 1]) : s.pts.map(lngLat) },
    })),
  };
}

function pointsData(items: { p: Point; props: Record<string, unknown> }[]): FeatureCollection<GeoPoint> {
  return {
    type: 'FeatureCollection',
    features: items.map<Feature<GeoPoint>>(({ p, props }) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: lngLat(p) } })),
  };
}

/** What the camera should show for a day: the day, where you came from, and anything mapped inside it. */
function focusPoints(days: Day[], idx: number): Point[] {
  const d = days[idx];
  const pts: Point[] = d.point ? [d.point] : [];
  const prev = days[idx - 1]?.point;
  if (prev && d.point && !same(prev, d.point)) pts.push(prev);
  for (const e of d.entries) {
    if (e.at) pts.push(e.at);
    if (e.kind === 'commute') for (const l of e.legs) for (const p of [l.fromPoint, l.toPoint]) if (p) pts.push(p);
  }
  return pts;
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const att = 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors';
const ras = (path: string, maxzoom = 16) => ({ type: 'raster' as const, tiles: [`${ESRI}/${path}/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom, attribution: att });
export type Base = 'dark' | 'terrain' | 'satellite';
const BASES: { id: Base; label: string; layers: string[] }[] = [
  { id: 'dark', label: 'Dark', layers: ['dark', 'dark-labels'] },
  { id: 'terrain', label: 'Terrain', layers: ['terrain'] },
  { id: 'satellite', label: 'Satellite', layers: ['sat', 'sat-labels'] },
];
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: ras('Canvas/World_Dark_Gray_Base'),
    labels: ras('Canvas/World_Dark_Gray_Reference'),
    terrain: ras('World_Topo_Map', 17),
    sat: ras('World_Imagery', 17),
    satlabels: ras('Reference/World_Boundaries_and_Places', 17),
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#111d22' } },
    { id: 'dark', type: 'raster', source: 'carto' },
    { id: 'dark-labels', type: 'raster', source: 'labels' },
    { id: 'terrain', type: 'raster', source: 'terrain', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.15, 'raster-brightness-max': 0.92 } },
    { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: { 'raster-brightness-max': 0.85 } },
    { id: 'sat-labels', type: 'raster', source: 'satlabels', layout: { visibility: 'none' } },
  ],
};

const storedBase = (): Base => {
  try {
    const v = localStorage.getItem('traililo:base');
    if (v === 'terrain' || v === 'satellite' || v === 'dark') return v;
  } catch {
    /* no storage */
  }
  return 'dark';
};

const dotColor: maplibregl.ExpressionSpecification = ['match', ['get', 'cat'], ...Object.entries(CATS).flatMap(([k, v]) => [k, v.color]), '#ffffff'] as unknown as maplibregl.ExpressionSpecification;

export function MapView({ trip, active, labelFor, visible, tracks, focus }: { trip: Trip; active: string; labelFor: (d: Day) => string; visible: boolean; tracks: Tracks; focus: Focus | null }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const showRef = useRef<((p: maplibregl.LngLatLike, t: string, f: string, n?: string, url?: string, cat?: Cat) => void) | null>(null);
  const markerRef = useRef<{ marker: maplibregl.Marker; label: HTMLElement; el: HTMLElement } | null>(null);
  const pinsRef = useRef<maplibregl.Marker[]>([]);
  const stayRef = useRef<{ key: string; el: HTMLElement }[]>([]);
  const stayMarkers = useRef<maplibregl.Marker[]>([]);
  const crowd = useRef(0);
  const [ready, setReady] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tiles, setTiles] = useState({ ok: 0, bad: 0 });
  const [base, setBase] = useState<Base>(storedBase);
  const [legend, setLegend] = useState(false);
  const [dayCats, setDayCats] = useState<Cat[]>([]);

  const days = trip.days;
  const pois = trip.pois ?? [];
  const activeIdx = Math.max(0, days.findIndex((d) => d.date === active));
  const segs = useMemo(() => segmentsOf(trip), [trip]);
  const pins = useMemo(() => {
    const m = new Map<string, { p: Point; first: number }>();
    days.forEach((d, i) => {
      if (d.point && !m.has(`${d.point.lat},${d.point.lon}`)) m.set(`${d.point.lat},${d.point.lon}`, { p: d.point, first: i });
    });
    return [...m.values()];
  }, [days]);
  const dots = (list: Poi[]) => pointsData(list.map((x) => ({ p: x.point, props: { id: x.id, cat: x.cat, name: x.name, date: x.date ?? '', note: x.note ?? '', url: x.url ?? '' } })));

  // ---------- create the map once ----------
  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: [-70, -46],
      zoom: 4,
      minZoom: 2.5,
      maxZoom: 17,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: routeData(segs) });
      map.addSource('pins', { type: 'geojson', data: pointsData(pins.map(({ p, first }) => ({ p, props: { first } }))) });
      map.addSource('poidots', { type: 'geojson', data: dots(pois) });
      map.addSource('trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
      map.addLayer({ id: 'route-later', type: 'line', source: 'route', paint: { 'line-color': FOG, 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [1, 2.5] } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: round, paint: { 'line-color': NIGHT, 'line-width': ['match', ['get', 'mode'], 'trek', 7, 6], 'line-opacity': 0.55, 'line-blur': 1.5 } });
      map.addLayer({
        id: 'route-done',
        type: 'line',
        source: 'route',
        layout: round,
        paint: {
          'line-color': ['match', ['get', 'mode'], 'ferry', BERRY, 'trek', CORAL, 'scenic', MINT, ICE],
          'line-width': ['match', ['get', 'mode'], 'trek', 3.8, 'scenic', 3.4, 2.8],
          'line-dasharray': ['match', ['get', 'mode'], 'scenic', ['literal', [2.2, 1.4]], ['literal', [1, 0]]],
        },
      });
      map.addLayer({ id: 'route-flight', type: 'line', source: 'route', paint: { 'line-color': BERRY, 'line-width': 2.2, 'line-dasharray': [2, 2] } });
      map.addLayer({ id: 'pins-later', type: 'circle', source: 'pins', paint: { 'circle-radius': 4.5, 'circle-color': NIGHT, 'circle-stroke-color': FOG, 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'pins-done', type: 'circle', source: 'pins', paint: { 'circle-radius': 4.5, 'circle-color': ICE, 'circle-stroke-color': NIGHT, 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'trail-casing', type: 'line', source: 'trail', layout: round, paint: { 'line-color': NIGHT, 'line-width': 8, 'line-opacity': 0.7, 'line-blur': 1 } });
      map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', layout: round, paint: { 'line-color': AMBER, 'line-width': 3.8 } });
      map.addLayer({
        id: 'poi-dots',
        type: 'circle',
        source: 'poidots',
        minzoom: 6,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6],
          'circle-color': dotColor,
          'circle-stroke-color': NIGHT,
          'circle-stroke-width': 1.6,
          'circle-opacity': 0.9,
        },
      });

      // tapping a place or a trail opens its name and details
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', offset: 14, className: 'tl-popup' });
      popupRef.current = popup;
      const show = (lngLat: maplibregl.LngLatLike, title: string, facts: string, note?: string, url?: string, cat?: Cat) => {
        const el = document.createElement('div');
        if (cat) {
          const k = document.createElement('em');
          k.textContent = CATS[cat].label;
          k.style.color = CATS[cat].color;
          el.append(k);
        }
        const h = document.createElement('b');
        h.textContent = title;
        el.append(h);
        if (facts) {
          const f = document.createElement('p');
          f.textContent = facts;
          el.append(f);
        }
        if (note) {
          const n = document.createElement('small');
          n.textContent = note;
          el.append(n);
        }
        if (url) {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = /alltrails/.test(url) ? 'Open on AllTrails' : 'Open page';
          el.append(a);
        }
        popup.setLngLat(lngLat).setDOMContent(el).addTo(map);
      };
      showRef.current = show;
      for (const layer of ['poi-dots', 'trail-line']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
      map.on('click', 'poi-dots', (ev) => {
        const f = ev.features?.[0];
        if (!f) return;
        const pr = f.properties ?? {};
        const g = f.geometry as GeoPoint;
        show(g.coordinates as [number, number], String(pr.name), '', pr.note ? String(pr.note) : undefined, pr.url ? String(pr.url) : undefined, pr.cat as Cat);
      });
      map.on('click', 'trail-line', (ev) => {
        if (map.queryRenderedFeatures(ev.point, { layers: ['poi-dots'] }).length) return;
        const f = ev.features?.[0];
        if (f) show(ev.lngLat, String(f.properties?.title ?? 'Trail'), String(f.properties?.facts ?? ''), 'Trail drawn from OpenStreetMap', undefined, 'hike');
      });

      const el = document.createElement('div');
      el.className = 'now';
      el.innerHTML = '<span class="ring"></span><span class="dot"></span><span class="label"></span>';
      const marker = new maplibregl.Marker({ element: el }).setLngLat([-70, -46]).addTo(map);
      markerRef.current = { marker, label: el.querySelector('.label') as HTMLElement, el };

      const labels = () => {
        const z = map.getZoom();
        map.getContainer().classList.toggle('show-labels', z >= 10.6 || (z >= 8.2 && crowd.current <= 8));
      };
      map.on('zoom', labels);
      labels();
      setReady(true);
    });

    map.on('data', (e) => {
      if ('tile' in e && (e as { sourceId?: string }).sourceId === 'carto' && (e as { tile?: unknown }).tile) setTiles((t) => (t.ok > 20 ? t : { ...t, ok: t.ok + 1 }));
    });
    map.on('error', (e) => {
      if ((e as { sourceId?: string }).sourceId === 'carto') setTiles((t) => ({ ...t, bad: t.bad + 1 }));
    });

    return () => {
      pinsRef.current.forEach((m) => m.remove());
      pinsRef.current = [];
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setReady(false);
    };
    // the map is created once; later changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // edits that move places change the drawn route
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(routeData(segs));
    (map.getSource('pins') as maplibregl.GeoJSONSource | undefined)?.setData(pointsData(pins.map(({ p, first }) => ({ p, props: { first } }))));
    (map.getSource('poidots') as maplibregl.GeoJSONSource | undefined)?.setData(dots(pois));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, segs, pins, pois]);


  // ---------- where you sleep ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    stayMarkers.current.forEach((x) => x.remove());
    stayMarkers.current = [];
    stayRef.current = [];
    const at = new Map<string, typeof trip.stays>();
    for (const st of trip.stays) if (st.point) at.set(`${st.point.lat},${st.point.lon}`, [...(at.get(`${st.point.lat},${st.point.lon}`) ?? []), st]);
    for (const [key, list] of at) {
      const st = list[0];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin stay';
      el.style.setProperty('--c', CATS.stay.color);
      el.setAttribute('aria-label', list.map((x) => x.name).join(', '));
      const disc = document.createElement('span');
      disc.className = 'disc';
      disc.append(glyphSvg('stay'));
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = list.map((x) => x.name).join(' · ');
      el.append(disc, lbl);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const nights = (x: (typeof list)[number]) => `${x.nights} ${x.nights === 1 ? 'night' : 'nights'}, from ${new Date(x.checkIn + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
        showRef.current?.(lngLat(st.point!), list.map((x) => x.name).join(' · '), list.map(nights).join(' · '), st.point!.approx ? 'Town-level position' : undefined, undefined, 'stay');
      });
      stayRef.current.push({ key, el });
      stayMarkers.current.push(new maplibregl.Marker({ element: el, anchor: 'center', offset: [0, -30] }).setLngLat(lngLat(st.point!)).addTo(map));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, trip.stays]);

  // tonight's bed is the one that is named
  useEffect(() => {
    const d = days[activeIdx];
    const st = trip.stays.find((x) => x.id === d?.stayId);
    const key = st?.point ? `${st.point.lat},${st.point.lon}` : '';
    for (const s of stayRef.current) s.el.classList.toggle('tonight', s.key === key);
  }, [ready, activeIdx, trip.stays, days]);

  // choose the basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const on = new Set(BASES.find((b) => b.id === base)!.layers);
    for (const b of BASES) for (const id of b.layers) map.setLayoutProperty(id, 'visibility', on.has(id) ? 'visible' : 'none');
    map.getContainer().dataset.base = base;
    try {
      localStorage.setItem('traililo:base', base);
    } catch {
      /* fine without it */
    }
  }, [ready, base]);

  // reading a different day ends "whole trip" mode
  useEffect(() => setShowAll(false), [active]);

  // ---------- follow the day ----------
  useEffect(() => {
    const map = mapRef.current;
    const m = markerRef.current;
    if (!ready || !map || !m || !visible) return;
    map.resize();
    const day = days[activeIdx];

    map.setFilter('route-later', ['>', ['get', 'day'], activeIdx]);
    map.setFilter('route-casing', ['all', ['<=', ['get', 'day'], activeIdx], ['!=', ['get', 'mode'], 'flight']]);
    map.setFilter('route-done', ['all', ['<=', ['get', 'day'], activeIdx], ['!=', ['get', 'mode'], 'flight']]);
    map.setFilter('route-flight', ['all', ['<=', ['get', 'day'], activeIdx], ['==', ['get', 'mode'], 'flight']]);
    map.setFilter('pins-later', ['>', ['get', 'first'], activeIdx]);
    map.setFilter('pins-done', ['<=', ['get', 'first'], activeIdx]);
    // the day's own places are drawn as pins, so the small dots keep to the other days
    map.setFilter('poi-dots', showAll ? null : ['!=', ['get', 'date'], day.date]);
    popupRef.current?.remove();

    // ----- pins with names for what happens today -----
    pinsRef.current.forEach((x) => x.remove());
    pinsRef.current = [];
    const startOf = (e: Entry): Point | undefined => (tracks[e.id] ? { lon: tracks[e.id].lines[0][0][0], lat: tracks[e.id].lines[0][0][1] } : e.at);
    interface Item { p: Point; cat: Cat; name: string; facts: string; note?: string; url?: string; badge?: string }
    const items: Item[] = [];
    for (const e of day.entries) {
      const p = startOf(e);
      if (!p || e.kind === 'commute') continue;
      items.push({ p, cat: catOfEntry(e), name: e.title, facts: factsOf(e), note: tracks[e.id] ? 'Trail drawn from OpenStreetMap' : e.at?.approx ? 'Approximate spot' : undefined });
    }
    for (const x of pois.filter((q) => q.date === day.date)) items.push({ p: x.point, cat: x.cat, name: x.name, facts: '', note: x.note, url: x.url, badge: x.badge });
    items.forEach((it, n) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin';
      el.style.setProperty('--c', CATS[it.cat].color);
      el.setAttribute('aria-label', it.name);
      const disc = document.createElement('span');
      disc.className = 'disc';
      if (it.badge) disc.textContent = it.badge;
      else disc.append(glyphSvg(it.cat));
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = it.name;
      el.append(disc, lbl);
      el.style.zIndex = String(10 + n);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showRef.current?.(lngLat(it.p), it.name, it.facts, it.note, it.url, it.cat);
      });
      pinsRef.current.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat(it.p)).addTo(map));
    });
    setDayCats([...new Set(items.map((i) => i.cat))]);
    crowd.current = items.length;

    (map.getSource('trail') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: day.entries.filter((e) => tracks[e.id]).map<Feature<MultiLineString>>((e) => ({
        type: 'Feature',
        properties: { title: e.title, facts: `${tracks[e.id].km} km of trail mapped` },
        geometry: { type: 'MultiLineString', coordinates: tracks[e.id].lines as number[][][] },
      })),
    });

    if (day.point) {
      m.marker.setLngLat(lngLat(day.point));
      m.label.textContent = labelFor(day);
    }

    const duration = reduced() ? 0 : 900;
    const pad = { top: 64, bottom: 64, left: 56, right: 56 };
    const fit = (pts: Point[], maxZoom: number, padding = pad) => {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend(lngLat(p)));
      map.fitBounds(b, { padding, maxZoom, duration });
    };
    if (showAll) {
      fit(days.map((d) => d.point).filter((p): p is Point => !!p), 7, { top: 70, bottom: 56, left: 56, right: 56 });
    } else {
      // a day full of stops is framed by the stops, not by where the night ends
      const pts = items.length >= 3 ? [] : focusPoints(days, activeIdx);
      // stations and rental desks far from the walking do not stretch the frame
      for (const it of items) if (items.length < 3 || (it.cat !== 'transport' && it.cat !== 'car')) pts.push(it.p);
      if (items.length < 3) for (const l of trip.lines ?? []) if (l.date === day.date) pts.push(...l.points);
      for (const e of day.entries) for (const l of tracks[e.id]?.lines ?? []) for (const [x, y] of l) pts.push({ lon: x, lat: y });
      map.fire('zoom');
      if (pts.length <= 1 && pts[0]) map.easeTo({ center: lngLat(pts[0]), zoom: 9.2, duration });
      else fit(pts, 10.5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeIdx, showAll, days, pois, labelFor, visible, tracks]);

  // tapping an activity in the list: zoom to it and open its card
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !visible || !focus) return;
    const e = days[activeIdx].entries.find((x) => x.id === focus.id);
    if (!e) return;
    const tr = tracks[e.id];
    const b = new maplibregl.LngLatBounds();
    if (tr) for (const l of tr.lines) for (const [x, y] of l) b.extend([x, y]);
    else if (e.at) b.extend(lngLat(e.at));
    else return;
    map.fitBounds(b, { padding: { top: 80, bottom: 120, left: 50, right: 50 }, maxZoom: 14, duration: reduced() ? 0 : 900 });
    const at = tr ? { lon: tr.lines[0][0][0], lat: tr.lines[0][0][1] } : e.at;
    if (at) showRef.current?.(lngLat(at), e.title, factsOf(e), tr ? 'Trail drawn from OpenStreetMap' : 'Approximate spot', undefined, catOfEntry(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, ready, visible]);

  // keep the label on screen: flip it to the left of the pin near the right edge
  useEffect(() => {
    const map = mapRef.current;
    const m = markerRef.current;
    if (!ready || !map || !m) return;
    const flip = () => {
      const p = map.project(m.marker.getLngLat());
      m.el.classList.toggle('flip', p.x > map.getContainer().clientWidth - 190);
    };
    map.on('move', flip);
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(map.getContainer());
    flip();
    return () => {
      map.off('move', flip);
      ro.disconnect();
    };
  }, [ready, activeIdx]);

  const noTiles = tiles.bad >= 3 && tiles.ok === 0;
  const legendCats = (['stay', 'hike', 'sight', 'view', 'lake', 'waterfall', 'water', 'thermal', 'bike', 'transport', 'car', 'town'] as Cat[]).filter((c) => legend || dayCats.includes(c));
  return (
    <div className="map">
      <div className="map-canvas" ref={box} role="application" aria-label="Route map of the trip, up to the day you are reading" />
      <div className="map-ui">
        <button type="button" onClick={() => setShowAll(true)} aria-pressed={showAll}>
          Whole trip
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          −
        </button>
      </div>
      <div className="map-base" role="group" aria-label="Map style">
        {BASES.map((b) => (
          <button key={b.id} type="button" aria-pressed={base === b.id} onClick={() => setBase(b.id)}>
            {b.label}
          </button>
        ))}
      </div>
      {legendCats.length > 0 && (
        <div className="map-legend" data-open={legend}>
          <button type="button" onClick={() => setLegend((v) => !v)} aria-expanded={legend}>
            {legend ? 'Hide key' : 'Key'}
          </button>
          <ul>
            {legendCats.map((c) => (
              <li key={c} style={{ ['--c' as string]: CATS[c].color }}>
                <i />
                {CATS[c].label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {noTiles && <p className="map-note">Basemap tiles need a connection. Your route is drawn either way.</p>}
    </div>
  );
}
