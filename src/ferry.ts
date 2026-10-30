// Ferry lines: follows a charted ferry route from OpenStreetMap when one joins the two harbours, so the line stays on the water.
import type { Point } from './model.ts';
import type { Road } from './roads.ts';
import { simplify } from './gpx.ts';

type Pt = [number, number]; // lon, lat
const km = (a: Pt, b: Pt) => Math.hypot((b[0] - a[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (b[1] - a[1]) * 110.57);

interface El {
  type: 'way' | 'relation';
  geometry?: { lat: number; lon: number }[];
  members?: { geometry?: { lat: number; lon: number }[] }[];
}

/** Joins the pieces of a ferry route into one line running from the start to the end. */
function chain(pieces: Pt[][], from: Pt, to: Pt): Pt[] {
  const left = pieces.filter((p) => p.length > 1);
  if (!left.length) return [];
  // begin with the piece end nearest the start
  let best = { d: Infinity, i: 0, rev: false };
  left.forEach((p, i) => {
    for (const rev of [false, true]) {
      const e = rev ? p[p.length - 1] : p[0];
      const d = km(from, e);
      if (d < best.d) best = { d, i, rev };
    }
  });
  let line = best.rev ? [...left[best.i]].reverse() : [...left[best.i]];
  left.splice(best.i, 1);
  while (left.length) {
    const tip = line[line.length - 1];
    let nx = { d: Infinity, i: -1, rev: false };
    left.forEach((p, i) => {
      for (const rev of [false, true]) {
        const d = km(tip, rev ? p[p.length - 1] : p[0]);
        if (d < nx.d) nx = { d, i, rev };
      }
    });
    if (nx.i < 0 || nx.d > 3) break;
    const p = left.splice(nx.i, 1)[0];
    line = line.concat(nx.rev ? [...p].reverse() : p);
  }
  return km(line[0], to) < km(line[0], from) ? line.reverse() : line;
}

/** A ferry line between two harbours, or null if OpenStreetMap has none that joins both. */
export async function routeFerry(a: Point, b: Point): Promise<Road | null> {
  const near = (p: Point) => `way[route=ferry](around:6000,${p.lat},${p.lon});rel[route=ferry](around:6000,${p.lat},${p.lon});`;
  const q = `[out:json][timeout:25];(${near(a)});->.a;(${near(b)});->.b;(way.a.b;rel.a.b;);out geom;`;
  let r: Response;
  try {
    r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const j = (await r.json()) as { elements?: El[] };
  const A: Pt = [a.lon, a.lat];
  const B: Pt = [b.lon, b.lat];
  let bestLine: Pt[] = [];
  let bestLen = Infinity;
  for (const e of j.elements ?? []) {
    const pieces: Pt[][] = e.type === 'way' ? [(e.geometry ?? []).map((g) => [g.lon, g.lat] as Pt)] : (e.members ?? []).filter((m) => m.geometry).map((m) => m.geometry!.map((g) => [g.lon, g.lat] as Pt));
    const line = chain(pieces, A, B);
    if (line.length < 2) continue;
    let len = 0;
    for (let i = 1; i < line.length; i++) len += km(line[i - 1], line[i]);
    // the shortest charted line that really joins both ends
    if (km(line[0], A) < 8 && km(line[line.length - 1], B) < 8 && len < bestLen) {
      bestLine = line;
      bestLen = len;
    }
  }
  if (bestLine.length < 2) return null;
  const path = simplify([A, ...bestLine, B], 0.0003).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as [number, number]);
  const dist = Math.round(bestLen * 10) / 10;
  return { path, km: dist, min: Math.round((dist / 26) * 60) };
}
