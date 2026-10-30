// Saving the trip for use without signal: the map tiles along the route, and the pictures.
import type { Trip } from './model.ts';
import type { Tracks } from './MapView.tsx';
import { PHOTOS, photoUrl } from './photos.ts';
import { photoUrlOf } from './backend.ts';

export type BaseId = 'dark' | 'terrain' | 'satellite';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const LAYERS: Record<BaseId, { path: string; kb: number }[]> = {
  dark: [
    { path: 'Canvas/World_Dark_Gray_Base', kb: 9 },
    { path: 'Canvas/World_Dark_Gray_Reference', kb: 6 },
  ],
  terrain: [{ path: 'World_Topo_Map', kb: 28 }],
  satellite: [
    { path: 'World_Imagery', kb: 40 },
    { path: 'Reference/World_Boundaries_and_Places', kb: 6 },
  ],
};

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

interface Pt {
  lon: number;
  lat: number;
}

/** Every place on the route, and a thinned copy of every drawn trail. */
function routePoints(trip: Trip, tracks: Tracks): { path: Pt[]; sites: Pt[] } {
  const path: Pt[] = [];
  const sites: Pt[] = [];
  const add = (a: Pt[], p?: Pt) => p && a.push({ lon: p.lon, lat: p.lat });
  for (const d of trip.days) {
    add(path, d.point);
    for (const e of d.entries) {
      add(sites, e.at);
      if (e.kind === 'commute') for (const l of e.legs) [l.fromPoint, l.toPoint].forEach((p) => add(path, p));
      for (const ln of tracks[e.id]?.lines ?? []) {
        let last: Pt | null = null;
        for (const [x, y] of ln) {
          // keep a point about every 600 m
          if (!last || Math.hypot((x - last.lon) * 80, (y - last.lat) * 111) > 0.6) {
            const p = { lon: x, lat: y };
            sites.push(p);
            last = p;
          }
        }
      }
    }
  }
  for (const s of trip.stays) add(sites, s.point);
  for (const p of trip.pois ?? []) add(sites, p.point);
  for (const l of trip.lines ?? []) l.points.forEach((p) => add(path, p));
  // straight legs between consecutive places, so the corridor has no gaps
  const dense: Pt[] = [];
  for (let i = 0; i < path.length; i++) {
    dense.push(path[i]);
    const n = path[i + 1];
    if (!n) continue;
    const steps = Math.min(60, Math.ceil(Math.hypot((n.lon - path[i].lon) * 80, (n.lat - path[i].lat) * 111) / 10));
    for (let k = 1; k < steps; k++) dense.push({ lon: path[i].lon + ((n.lon - path[i].lon) * k) / steps, lat: path[i].lat + ((n.lat - path[i].lat) * k) / steps });
  }
  return { path: dense, sites };
}

/** The tiles to save: a wide corridor at country scale, then close-ups around places and trails. */
export function tileList(trip: Trip, tracks: Tracks, base: BaseId): { urls: string[]; estimateMb: number } {
  const { path, sites } = routePoints(trip, tracks);
  // [zoom, ring size around each point, which points]
  const plan: [number, number, Pt[]][] = [
    [4, 1, path], [5, 1, path], [6, 1, path], [7, 1, path], [8, 1, path], [9, 1, path], [10, 1, path],
    [11, 1, [...path, ...sites]], [12, 1, sites], [13, 1, sites], [14, 1, sites],
  ];
  const set = new Set<string>();
  for (const [z, ring, pts] of plan) {
    const max = 2 ** z - 1;
    for (const p of pts) {
      const cx = tileX(p.lon, z);
      const cy = tileY(p.lat, z);
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && y >= 0 && x <= max && y <= max) set.add(`${z}/${y}/${x}`);
        }
    }
  }
  const urls: string[] = [];
  for (const l of LAYERS[base]) for (const t of set) urls.push(`${ESRI}/${l.path}/MapServer/tile/${t}`);
  const kb = LAYERS[base].reduce((n, l) => n + l.kb, 0);
  return { urls, estimateMb: Math.round((set.size * kb) / 1024) };
}

/** Pictures worth keeping: the place photos and anything uploaded. */
export function imageList(trip: Trip): string[] {
  const out = new Set<string>();
  for (const d of trip.days) if (!(trip.photos?.[d.region]) && PHOTOS[d.region]) out.add(photoUrl(PHOTOS[d.region]));
  for (const path of Object.values(trip.photos ?? {})) out.add(photoUrlOf(path));
  for (const d of trip.days) for (const path of d.journal?.photos ?? []) out.add(photoUrlOf(path));
  return [...out];
}

export const savedKey = (base: BaseId) => `traililo:saved:${base}`;
