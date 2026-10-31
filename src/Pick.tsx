// A small map to tap on, for pinning a spot without searching for its name.
import { createContext, useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Point, Trip } from './model.ts';
import { nameSpot } from './geocode.ts';

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { t: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: 'Tiles © Esri' } },
  layers: [{ id: 't', type: 'raster', source: 't' }],
};

/** What the editors know about the plan, so a map can show it: the whole trip and the day being worked on. */
export const PlanCtx = createContext<{ trip: Trip; date?: string; tracks?: Record<string, { lines: number[][][] }> } | null>(null);

export type PlanKind = 'stay' | 'hike' | 'activity' | 'travel' | 'spot' | 'town';
export interface PlanPlace { name: string; kind: PlanKind; point: Point }

/** Every place in the plan that has a spot on the map. */
export function planPlaces(trip: Trip, tracks?: Record<string, { lines: number[][][] }>): PlanPlace[] {
  const out: PlanPlace[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: PlanKind, point?: Point) => {
    if (!point) return;
    const k = `${kind}${point.lat.toFixed(3)}${point.lon.toFixed(3)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ name, kind, point });
  };
  const regions = new Set<string>();
  for (const d of trip.days) {
    if (d.point && !regions.has(d.region)) { regions.add(d.region); add(d.region, 'town', d.point); }
    for (const e of d.entries) {
      if (e.kind === 'commute') { for (const l of e.legs ?? []) { add(l.from || 'Start', 'travel', l.fromPoint); add(l.to || 'End', 'travel', l.toPoint); } }
      else if (e.kind === 'hike') { const t0 = tracks?.[e.id]?.lines[0]?.[0]; add(e.title, 'hike', e.at ?? (t0 ? { lat: t0[1], lon: t0[0] } : undefined)); for (const w of e.waypoints ?? []) add(w.name, 'hike', w.point); }
      else add(e.title, 'activity', e.at);
    }
  }
  for (const st of trip.stays) add(st.name, 'stay', st.point);
  for (const po of trip.pois ?? []) add(po.name, 'spot', po.point);
  for (const l of trip.lines ?? []) for (const x of l.stops ?? []) add(x.name, 'spot', x.point);
  return out;
}

export interface PlanLine { coords: number[][]; color: string; dash: boolean }

/** Every trail and drive in the plan, as lines. */
export function planLines(trip: Trip, tracks?: Record<string, { lines: number[][][] }>): PlanLine[] {
  const out: PlanLine[] = [];
  const hikeIds = new Set<string>();
  for (const d of trip.days) {
    for (const e of d.entries) {
      if (e.kind === 'hike') hikeIds.add(e.id);
      if (e.kind === 'commute') {
        for (const l of e.legs ?? []) {
          const coords = l.path?.length ? l.path : l.fromPoint && l.toPoint ? [[l.fromPoint.lon, l.fromPoint.lat], [l.toPoint.lon, l.toPoint.lat]] : null;
          if (coords) out.push({ coords, color: LINE_COLOR[l.mode] ?? '#b3261e', dash: l.mode === 'flight' || l.mode === 'ferry' });
        }
      }
    }
  }
  for (const id of hikeIds) for (const ln of tracks?.[id]?.lines ?? []) if (ln.length > 1) out.push({ coords: ln, color: '#3f7a2c', dash: false });
  const lc: Record<string, string> = { drive: '#b3261e', ferry: '#1f5f8b', trek: '#3f7a2c', scenic: '#7a2e8a' };
  for (const l of trip.lines ?? []) if (l.points.length > 1) out.push({ coords: l.points.map((q) => [q.lon, q.lat]), color: lc[l.mode] ?? '#b3261e', dash: l.mode === 'ferry' || l.mode === 'trek' });
  return out;
}

const LINE_COLOR: Record<string, string> = { drive: '#b3261e', bus: '#b3261e', taxi: '#b3261e', ferry: '#1f5f8b', flight: '#7a2e8a' };

/** Where a map for this day should open when nothing has been chosen yet. */
export function planAnchor(trip: Trip, date?: string): Point | undefined {
  const d = date ? trip.days.find((x) => x.date === date) : undefined;
  return d?.point ?? trip.stays.find((x) => x.id === d?.stayId)?.point;
}

const KIND_LABEL: Record<PlanKind, string> = { stay: 'Sleep', hike: 'Hike', activity: 'Activity', travel: 'Travel', spot: 'Spot', town: 'Town' };

export function MapPick({ near, current, onPick, plan, results, pickable = true, anchor, lines }: { near?: Point; current?: Point; onPick: (name: string, p: Point) => void; plan?: PlanPlace[]; results?: { name: string; point: Point }[]; pickable?: boolean; anchor?: Point; lines?: PlanLine[] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const mark = useRef<maplibregl.Marker | null>(null);
  const planMarks = useRef<maplibregl.Marker[]>([]);
  const resMarks = useRef<maplibregl.Marker[]>([]);
  const fitted = useRef(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const lineData = (l?: PlanLine[]) => ({ type: 'FeatureCollection' as const, features: (l ?? []).map((x) => ({ type: 'Feature' as const, properties: { color: x.color, dash: x.dash ? 1 : 0 }, geometry: { type: 'LineString' as const, coordinates: x.coords } })) });
  const linesReady = useRef(false);
  const cb = useRef(onPick);
  cb.current = onPick;
  const can = useRef(pickable);
  can.current = pickable;
  const setMark = (m: maplibregl.Map, p?: Point) => {
    mark.current?.remove();
    mark.current = p ? new maplibregl.Marker({ color: '#9a8cf0' }).setLngLat([p.lon, p.lat]).addTo(m) : null;
  };
  useEffect(() => {
    if (!box.current) return;
    const c = near ?? current ?? anchor;
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: c ? [c.lon, c.lat] : [-70.5, -46], zoom: c ? 9 : 3.4, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('click', async (e) => {
      if (!can.current) return;
      const p = { lat: Math.round(e.lngLat.lat * 1e5) / 1e5, lon: Math.round(e.lngLat.lng * 1e5) / 1e5 };
      setMark(m, p);
      cb.current(await nameSpot(p), p);
    });
    if (current) setMark(m, current);
    m.on('load', () => {
      m.addSource('plan-lines', { type: 'geojson', data: lineData(linesRef.current) });
      m.addLayer({ id: 'plan-lines-halo', type: 'line', source: 'plan-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f3e3b8', 'line-width': 4.5, 'line-opacity': 0.7 } });
      m.addLayer({ id: 'plan-lines-line', type: 'line', source: 'plan-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': ['case', ['==', ['get', 'dash'], 1], ['literal', [2, 1.6]], ['literal', [1, 0]]] } });
      linesReady.current = true;
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      linesReady.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A pin set from outside (a search result) moves the marker and the view.
  const curKey = current ? `${current.lat},${current.lon}` : '';
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    setMark(m, current);
    if (current) m.easeTo({ center: [current.lon, current.lat], zoom: Math.max(m.getZoom(), 9), duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);
  const linesKey = JSON.stringify((lines ?? []).map((x) => [x.coords.length, x.coords[0], x.color]));
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const put = () => (m.getSource('plan-lines') as maplibregl.GeoJSONSource | undefined)?.setData(lineData(lines));
    if (linesReady.current) put();
    else m.once('load', put);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);
  // The plan, drawn as small labelled dots.
  const planKey = JSON.stringify((plan ?? []).map((x) => [x.kind, x.point.lat, x.point.lon]));
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    planMarks.current.forEach((x) => x.remove());
    planMarks.current = (plan ?? []).map((x) => {
      const el = document.createElement('div');
      el.className = `plan-dot ${x.kind}`;
      el.title = `${KIND_LABEL[x.kind]}: ${x.name}`;
      const lab = document.createElement('span');
      lab.textContent = x.name.length > 20 ? `${x.name.slice(0, 19)}…` : x.name;
      el.appendChild(lab);
      el.addEventListener('click', (ev) => {
        if (!can.current) return;
        ev.stopPropagation();
        cb.current(x.name, { ...x.point });
        setMark(m, x.point);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([x.point.lon, x.point.lat]).addTo(m);
    });
    if (!fitted.current && plan?.length) {
      fitted.current = true;
      const c = near ?? current ?? anchor;
      const b = new maplibregl.LngLatBounds();
      if (c) {
        // Open on the centre with the closest few planned places in view.
        const d = (x: PlanPlace) => (x.point.lat - c.lat) ** 2 + ((x.point.lon - c.lon) * Math.cos((c.lat * Math.PI) / 180)) ** 2;
        b.extend([c.lon, c.lat]);
        [...plan].sort((x, y) => d(x) - d(y)).slice(0, 6).forEach((x) => b.extend([x.point.lon, x.point.lat]));
      } else plan.forEach((x) => b.extend([x.point.lon, x.point.lat]));
      m.fitBounds(b, { padding: 36, maxZoom: c ? 11 : 9, duration: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);
  // Search results, numbered; tap one to choose it.
  const resKey = JSON.stringify((results ?? []).map((x) => [x.point.lat, x.point.lon]));
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    resMarks.current.forEach((x) => x.remove());
    resMarks.current = (results ?? []).map((x, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'result-dot';
      el.textContent = String(i + 1);
      el.title = x.name;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        cb.current(x.name, { ...x.point, approx: true });
      });
      return new maplibregl.Marker({ element: el }).setLngLat([x.point.lon, x.point.lat]).addTo(m);
    });
    if (results?.length) {
      const b = new maplibregl.LngLatBounds();
      results.forEach((x) => b.extend([x.point.lon, x.point.lat]));
      if (current) b.extend([current.lon, current.lat]);
      m.fitBounds(b, { padding: 40, maxZoom: 12, duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resKey]);
  const kinds = [...new Set((plan ?? []).map((x) => x.kind))];
  return (
    <div className="map-pick">
      <div ref={box} className="map-pick-canvas" role="application" aria-label={pickable ? 'Map: tap to pin a spot' : 'Map of the plan'} />
      {kinds.length > 0 && (
        <p className="plan-legend" aria-label="What the dots are">
          {kinds.map((k) => <span key={k}><i className={`plan-dot-key ${k}`} />{KIND_LABEL[k]}</span>)}
        </p>
      )}
      <p className="small">{pickable ? 'Tap the map (or a dot) to pin a spot. Pinch or use + and − to move closer.' : 'Your plan around here. Press Map to pin a spot by tapping.'}</p>
    </div>
  );
}

// ---------------------------------------------------------------- the planned trip, drawn small
import type { Leg } from './model.ts';
import { minutes } from './derive.ts';

/** Stops in order, joining a leg to the previous one when it starts where that one ended; letters[i] = [from, to] per leg. */
function stopsOf(legs: Leg[]) {
  const pts: { lat: number; lon: number }[] = [];
  const letters: [number, number][] = [];
  const same = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
  legs.forEach((l, i) => {
    const prev = i ? pts.length - 1 : -1;
    let f = prev;
    if (prev < 0 || !same(pts[prev], l.fromPoint!)) { pts.push(l.fromPoint!); f = pts.length - 1; }
    pts.push(l.toPoint!);
    letters.push([f, pts.length - 1]);
  });
  return { pts, letters };
}

const MODE_COLOR: Record<string, string> = { drive: '#b3261e', bus: '#b3261e', taxi: '#b3261e', ferry: '#1f5f8b', flight: '#7a2e8a' };

/** A small map of the legs planned so far: each leg's line, lettered stops, and the time and distance of each leg. */
export function RouteMini({ legs }: { legs: Leg[] }) {
  const drawn = legs.filter((l) => l.fromPoint && l.toPoint);
  if (!drawn.length) return null;
  return <Mini legs={drawn} />;
}

function Mini({ legs }: { legs: Leg[] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marks = useRef<maplibregl.Marker[]>([]);
  const ready = useRef(false);
  const geo = (list: Leg[]) => ({
    type: 'FeatureCollection' as const,
    features: list.map((l) => ({
      type: 'Feature' as const,
      properties: { color: MODE_COLOR[l.mode] ?? '#b3261e', dash: l.mode === 'flight' || l.mode === 'ferry' ? 1 : 0 },
      geometry: { type: 'LineString' as const, coordinates: l.path?.length ? l.path : [[l.fromPoint!.lon, l.fromPoint!.lat], [l.toPoint!.lon, l.toPoint!.lat]] },
    })),
  });
  const draw = (m: maplibregl.Map, list: Leg[]) => {
    (m.getSource('legs') as maplibregl.GeoJSONSource | undefined)?.setData(geo(list));
    marks.current.forEach((x) => x.remove());
    marks.current = [];
    stopsOf(list).pts.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'mini-stop';
      el.textContent = String.fromCharCode(65 + i);
      marks.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(m));
    });
    const b = new maplibregl.LngLatBounds();
    for (const f of geo(list).features) for (const c of f.geometry.coordinates) b.extend(c as [number, number]);
    m.fitBounds(b, { padding: 36, maxZoom: 11, duration: 0 });
  };
  const key = JSON.stringify(legs.map((l) => [l.mode, l.fromPoint, l.toPoint, l.path?.length]));
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: [-70, -45], zoom: 3, interactive: false, attributionControl: { compact: true } });
    map.current = m;
    m.on('load', () => {
      m.addSource('legs', { type: 'geojson', data: geo(legs) });
      m.addLayer({ id: 'legs-halo', type: 'line', source: 'legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f3e3b8', 'line-width': 6, 'line-opacity': 0.8 } });
      m.addLayer({ id: 'legs-line', type: 'line', source: 'legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': ['case', ['==', ['get', 'dash'], 1], ['literal', [2, 1.6]], ['literal', [1, 0]]] } });
      ready.current = true;
      draw(m, legs);
    });
    return () => {
      marks.current.forEach((x) => x.remove());
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (map.current && ready.current) draw(map.current, legs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const totalKm = legs.reduce((n, l) => n + (l.distanceKm ?? 0), 0);
  const totalMin = legs.reduce((n, l) => n + (l.durationMin ?? 0), 0);
  return (
    <div className="mini-route" aria-label="The planned route">
      <div ref={box} className="mini-canvas" role="img" aria-label="Map of the planned legs" />
      <ol className="mini-legs">
        {legs.map((l, i) => (
          <li key={i}>
            <b>
              {String.fromCharCode(65 + stopsOf(legs).letters[i][0])} → {String.fromCharCode(65 + stopsOf(legs).letters[i][1])}
            </b>
            <span>
              {l.from || 'Start'} to {l.to || 'End'} · {l.mode}
            </span>
            <em>
              {l.distanceKm !== undefined ? `${l.distanceKm} km` : '…'}
              {l.durationMin ? ` · ${minutes(l.durationMin)}` : ''}
            </em>
          </li>
        ))}
      </ol>
      {legs.length > 1 && (
        <p className="mini-total">
          Total {Math.round(totalKm * 10) / 10} km{totalMin ? ` · ${minutes(totalMin)}` : ''}
        </p>
      )}
    </div>
  );
}
