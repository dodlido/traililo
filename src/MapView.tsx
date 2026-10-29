// Route map, built on MapLibre GL. Dark raster basemap tiles load from CARTO when you are online; the route and
// pins are drawn from the trip data, so they still show without tiles. The map follows the day you are reading:
// the route fills in up to that day and the camera flies to it.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerSource from 'worker-text';
import type { Feature, FeatureCollection, LineString, MultiLineString, Point as GeoPoint } from 'geojson';
import type { CommuteEntry, Day, Entry, HikeEntry, Point, Trip } from './model.ts';
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

type Mode = 'flight' | 'ferry' | 'drive' | 'trek';
interface Seg { from: Point; to: Point; mode: Mode; day: number }

const lngLat = (p: Point): [number, number] => [p.lon, p.lat];
const same = (a: Point, b: Point) => a.lat === b.lat && a.lon === b.lon;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function segmentsOf(days: Day[]): Seg[] {
  const segs: Seg[] = [];
  days.forEach((d, i) => {
    if (i === 0 || !d.point) return;
    const commute = d.entries.find((e): e is CommuteEntry => e.kind === 'commute');
    const legs = commute?.legs ?? [];
    if (legs.length > 1 && legs.every((l) => l.fromPoint && l.toPoint)) {
      for (const l of legs) segs.push({ from: l.fromPoint!, to: l.toPoint!, mode: l.mode === 'ferry' ? 'ferry' : 'drive', day: i });
      return;
    }
    const prev = days[i - 1].point;
    if (!prev || same(prev, d.point)) return;
    const m = legs[0]?.mode;
    const mode: Mode = m === 'flight' ? 'flight' : m === 'ferry' ? 'ferry' : m ? 'drive' : d.entries.some((e) => e.kind === 'hike') ? 'trek' : 'drive';
    segs.push({ from: prev, to: d.point, mode, day: i });
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
      properties: { day: s.day, mode: s.mode },
      geometry: { type: 'LineString', coordinates: s.mode === 'flight' ? arc(s.from, s.to) : [lngLat(s.from), lngLat(s.to)] },
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

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors',
    },
    labels: {
      type: 'raster',
      tiles: [`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 16,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#111d22' } },
    { id: 'basemap', type: 'raster', source: 'carto' },
    { id: 'basemap-labels', type: 'raster', source: 'labels' },
  ],
};

export function MapView({ trip, active, labelFor, visible, tracks, focus }: { trip: Trip; active: string; labelFor: (d: Day) => string; visible: boolean; tracks: Tracks; focus: Focus | null }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const showRef = useRef<((p: maplibregl.LngLatLike, t: string, f: string, n?: string) => void) | null>(null);
  const markerRef = useRef<{ marker: maplibregl.Marker; label: HTMLElement; el: HTMLElement } | null>(null);
  const [ready, setReady] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tiles, setTiles] = useState({ ok: 0, bad: 0 });

  const days = trip.days;
  const activeIdx = Math.max(0, days.findIndex((d) => d.date === active));
  const segs = useMemo(() => segmentsOf(days), [days]);
  const pins = useMemo(() => {
    const m = new Map<string, { p: Point; first: number }>();
    days.forEach((d, i) => {
      if (d.point && !m.has(`${d.point.lat},${d.point.lon}`)) m.set(`${d.point.lat},${d.point.lon}`, { p: d.point, first: i });
    });
    return [...m.values()];
  }, [days]);

  // ---------- create the map once ----------
  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: [-70, -46],
      zoom: 4,
      minZoom: 2.5,
      maxZoom: 16,
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
      map.addSource('sites', { type: 'geojson', data: pointsData([]) });
      map.addSource('trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'route-later', type: 'line', source: 'route', paint: { 'line-color': FOG, 'line-width': 1.5, 'line-opacity': 0.5, 'line-dasharray': [1, 2.5] } });
      map.addLayer({
        id: 'route-done',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'mode'], 'ferry', BERRY, ICE],
          'line-width': ['match', ['get', 'mode'], 'trek', 3.6, 2.6],
        },
      });
      map.addLayer({ id: 'route-flight', type: 'line', source: 'route', paint: { 'line-color': BERRY, 'line-width': 2.2, 'line-dasharray': [2, 2] } });
      map.addLayer({ id: 'pins-later', type: 'circle', source: 'pins', paint: { 'circle-radius': 4.5, 'circle-color': NIGHT, 'circle-stroke-color': FOG, 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'pins-done', type: 'circle', source: 'pins', paint: { 'circle-radius': 4.5, 'circle-color': ICE, 'circle-stroke-color': NIGHT, 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'trail-casing', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': NIGHT, 'line-width': 7, 'line-opacity': 0.75 } });
      map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': AMBER, 'line-width': 3.6 } });
      map.addLayer({ id: 'sites', type: 'circle', source: 'sites', paint: { 'circle-radius': 7, 'circle-color': AMBER, 'circle-stroke-color': NIGHT, 'circle-stroke-width': 2 } });

      // tapping a place or a trail opens its name and numbers
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px', offset: 12, className: 'tl-popup' });
      popupRef.current = popup;
      const show = (lngLat: maplibregl.LngLatLike, title: string, facts: string, note?: string) => {
        const box = document.createElement('div');
        const h = document.createElement('b');
        h.textContent = title;
        box.append(h);
        if (facts) {
          const f = document.createElement('p');
          f.textContent = facts;
          box.append(f);
        }
        if (note) {
          const n = document.createElement('small');
          n.textContent = note;
          box.append(n);
        }
        popup.setLngLat(lngLat).setDOMContent(box).addTo(map);
      };
      showRef.current = show;
      for (const layer of ['sites', 'trail-line']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
      map.on('click', 'sites', (ev) => {
        const f = ev.features?.[0];
        if (f) show(ev.lngLat, String(f.properties?.title ?? ''), String(f.properties?.facts ?? ''), f.properties?.hasTrack ? 'Trail drawn from OpenStreetMap' : 'Approximate spot');
      });
      map.on('click', 'trail-line', (ev) => {
        if (map.queryRenderedFeatures(ev.point, { layers: ['sites'] }).length) return;
        const f = ev.features?.[0];
        if (f) show(ev.lngLat, String(f.properties?.title ?? 'Trail'), String(f.properties?.facts ?? ''), 'Trail drawn from OpenStreetMap');
      });

      const el = document.createElement('div');
      el.className = 'now';
      el.innerHTML = '<span class="ring"></span><span class="dot"></span><span class="label"></span>';
      const marker = new maplibregl.Marker({ element: el }).setLngLat([-70, -46]).addTo(map);
      markerRef.current = { marker, label: el.querySelector('.label') as HTMLElement, el };
      setReady(true);
    });

    map.on('data', (e) => {
      if ('tile' in e && (e as { sourceId?: string }).sourceId === 'carto' && (e as { tile?: unknown }).tile) setTiles((t) => (t.ok > 20 ? t : { ...t, ok: t.ok + 1 }));
    });
    map.on('error', (e) => {
      if ((e as { sourceId?: string }).sourceId === 'carto') setTiles((t) => ({ ...t, bad: t.bad + 1 }));
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setReady(false);
    };
    // the map is created once; later changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    map.setFilter('route-done', ['all', ['<=', ['get', 'day'], activeIdx], ['!=', ['get', 'mode'], 'flight']]);
    map.setFilter('route-flight', ['all', ['<=', ['get', 'day'], activeIdx], ['==', ['get', 'mode'], 'flight']]);
    map.setFilter('pins-later', ['>', ['get', 'first'], activeIdx]);
    map.setFilter('pins-done', ['<=', ['get', 'first'], activeIdx]);
    popupRef.current?.remove();
    const mapped = day.entries.filter((e) => e.at || tracks[e.id]);
    const startOf = (e: Entry): Point => (tracks[e.id] ? { lon: tracks[e.id].lines[0][0][0], lat: tracks[e.id].lines[0][0][1] } : e.at!);
    (map.getSource('sites') as maplibregl.GeoJSONSource).setData(
      pointsData(mapped.map((e) => ({ p: e.at ?? startOf(e), props: { title: e.title, facts: factsOf(e), hasTrack: !!tracks[e.id] } }))),
    );
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
      const pts = focusPoints(days, activeIdx);
      for (const e of day.entries) for (const l of tracks[e.id]?.lines ?? []) for (const [x, y] of l) pts.push({ lon: x, lat: y });
      if (pts.length <= 1 && pts[0]) map.easeTo({ center: lngLat(pts[0]), zoom: 9.2, duration });
      else fit(pts, 10.5);
    }
  }, [ready, activeIdx, showAll, days, labelFor, visible, tracks]);

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
    const at = e.at ?? (tr ? { lon: tr.lines[0][0][0], lat: tr.lines[0][0][1] } : undefined);
    if (at) showRef.current?.(lngLat(at), e.title, factsOf(e), tr ? 'Trail drawn from OpenStreetMap' : 'Approximate spot');
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
      {noTiles && <p className="map-note">Basemap tiles need a connection. Your route is drawn either way.</p>}
    </div>
  );
}
