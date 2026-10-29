// Place search for pinning things on the map (OpenStreetMap's Nominatim; one search per tap, as its rules ask).
import type { Point } from './model.ts';

export interface Found {
  name: string;
  point: Point;
}
export async function searchPlace(q: string): Promise<Found[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
  if (!r.ok) throw new Error('Place search is unavailable right now.');
  const rows = (await r.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((x) => ({ name: x.display_name, point: { lat: +x.lat, lon: +x.lon } }));
}
