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

const inRange = (lat: number, lon: number) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const num = '-?\\d{1,3}(?:\\.\\d+)?';

/** A pin written straight into the search box: "-50.49, -73.13", degrees like 50°29'S 73°08'W, or a link from Google Maps, Apple Maps, OpenStreetMap or a geo: link. Short links (maps.app.goo.gl) hide their position, so they give a hint instead. */
export function parseCoords(input: string): { point: Point; name?: string } | { hint: string } | null {
  const t = input.trim();
  if (!t) return null;
  const ok = (lat: number, lon: number, name?: string) => (inRange(lat, lon) ? { point: { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 }, name } : null);
  if (/^https?:\/\//i.test(t) || /^geo:/i.test(t)) {
    let s = t;
    try { s = decodeURIComponent(t); } catch { /* keep as typed */ }
    const place = /\/place\/([^/@?]+)/.exec(s)?.[1]?.replace(/\+/g, ' ').trim();
    const name = place && !new RegExp(`^${num}[ ,]`).test(place) ? place : undefined;
    const pats = [
      new RegExp(`!3d(${num})!4d(${num})`),
      new RegExp(`@(${num}),(${num})`),
      new RegExp(`[?&#](?:q|ll|query|destination|daddr|center|coordinate|sll)=(${num})[, +]+(${num})`),
      new RegExp(`[?&]m?lat=(${num})&m?lon=(${num})`),
      new RegExp(`#map=\\d+/(${num})/(${num})`),
      new RegExp(`^geo:(${num}),(${num})`, 'i'),
    ];
    for (const re of pats) {
      const m = re.exec(s);
      if (m) {
        const r = ok(+m[1], +m[2], name);
        if (r) return r;
      }
    }
    return { hint: /goo\.gl|maps\.app|g\.co|omaps\.app|ge0\.me/i.test(t) ? 'That is a short link and it hides the position. Open it, then copy the address from the browser bar, or long-press the pin in Google Maps and copy the numbers at the top of the sheet.' : 'I could not find a position in that link. In Google Maps, long-press the spot and copy the numbers that appear.' };
  }
  const dms = [...t.matchAll(/(\d{1,3})\s*[°º]\s*(?:(\d{1,2})\s*['′]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')\s*)?([NSEW])/gi)];
  if (dms.length === 2) {
    const v = (m: RegExpMatchArray) => (+m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600) * (/[SW]/i.test(m[4]) ? -1 : 1);
    const [a, b] = dms;
    const latFirst = /[NS]/i.test(a[4]);
    const r = latFirst ? ok(v(a), v(b)) : ok(v(b), v(a));
    if (r) return r;
  }
  const m = new RegExp(`^\\(?\\s*(${num})\\s*°?\\s*[,; ]\\s*(${num})\\s*°?\\s*\\)?$`).exec(t);
  return m ? ok(+m[1], +m[2]) : null;
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Finds the pin for a booked place: the full address first, then the name with the end of the address. Searches run one at a time, a second apart, as Nominatim asks. */
export async function findStayPin(name: string, address?: string): Promise<{ point: Point; exact: boolean } | undefined> {
  const tail = address?.split(',').slice(-3).join(',').trim();
  const tries: { q: string; exact: boolean }[] = [
    ...(address ? [{ q: address, exact: true }] : []),
    ...(name && tail ? [{ q: `${name}, ${tail}`, exact: true }] : []),
    ...(tail ? [{ q: tail, exact: false }] : []),
  ];
  for (let i = 0; i < tries.length; i++) {
    if (i) await wait(1100);
    try {
      const [hit] = await searchPlace(tries[i].q);
      if (hit) return { point: tries[i].exact ? hit.point : { ...hit.point, approx: true }, exact: tries[i].exact };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
