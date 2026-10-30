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
