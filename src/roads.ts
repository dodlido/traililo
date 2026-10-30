// Finding the road between two places (OSRM's public routing service, by car and ignoring traffic).
import type { Point } from './model.ts';
import { simplify } from './gpx.ts';

export interface Road {
  path: [number, number][];
  km: number;
  min: number;
}

export async function routeRoad(pts: Point[]): Promise<Road> {
  const c = pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  let r: Response;
  try {
    r = await fetch(`https://router.project-osrm.org/route/v1/driving/${c}?overview=full&geometries=geojson`);
  } catch {
    throw new Error('Could not reach the road finder. Check your signal and try again.');
  }
  if (!r.ok) throw new Error('The road finder is not answering right now.');
  const j = (await r.json()) as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: number[][] } }[] };
  const rt = j.routes?.[0];
  if (j.code !== 'Ok' || !rt) throw new Error('No road found between those two places.');
  // about 20 m of detail is plenty for a map line
  const path = simplify(rt.geometry.coordinates, 0.0002).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as [number, number]);
  return { path, km: Math.round(rt.distance / 100) / 10, min: Math.round(rt.duration / 60) };
}
