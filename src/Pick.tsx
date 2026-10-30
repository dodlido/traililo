// A small map to tap on, for pinning a spot without searching for its name.
import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Point } from './model.ts';
import { nameSpot } from './geocode.ts';

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { t: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: 'Tiles © Esri' } },
  layers: [{ id: 't', type: 'raster', source: 't' }],
};

export function MapPick({ near, current, onPick }: { near?: Point; current?: Point; onPick: (name: string, p: Point) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const mark = useRef<maplibregl.Marker | null>(null);
  const cb = useRef(onPick);
  cb.current = onPick;
  useEffect(() => {
    if (!box.current) return;
    const c = near ?? current;
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: c ? [c.lon, c.lat] : [-70.5, -46], zoom: c ? 9 : 3.4, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('click', async (e) => {
      const p = { lat: Math.round(e.lngLat.lat * 1e5) / 1e5, lon: Math.round(e.lngLat.lng * 1e5) / 1e5 };
      setMark(p);
      cb.current(await nameSpot(p), p);
    });
    const setMark = (p: Point) => {
      mark.current?.remove();
      mark.current = new maplibregl.Marker({ color: '#9a8cf0' }).setLngLat([p.lon, p.lat]).addTo(m);
    };
    if (current) setMark(current);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="map-pick">
      <div ref={box} className="map-pick-canvas" role="application" aria-label="Map: tap to pin a spot" />
      <p className="small">Tap the map to pin a spot. Pinch or use + and − to move closer.</p>
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
