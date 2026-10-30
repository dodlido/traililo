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

/** A short name for a spot tapped on the map. */
export async function nameSpot(p: Point): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${p.lat}&lon=${p.lon}`, { headers: { 'Accept-Language': 'en' } });
    if (!r.ok) throw new Error('x');
    const j = (await r.json()) as { name?: string; display_name?: string };
    return (j.name || j.display_name?.split(',')[0] || '').trim() || 'Pinned spot';
  } catch {
    return 'Pinned spot';
  }
}
