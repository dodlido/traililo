// Distances on the globe, in one place.
import type { Point } from './model.ts';

const R = Math.PI / 180;
const unpack = (p: Point | [number, number]): [number, number] => (Array.isArray(p) ? p : [p.lon, p.lat]);

/** Great-circle distance in km between two places, each a point or a [lon, lat] pair. */
export function kmBetween(a: Point | [number, number], b: Point | [number, number]): number {
  const [alon, alat] = unpack(a);
  const [blon, blat] = unpack(b);
  const h = Math.sin(((blat - alat) * R) / 2) ** 2 + Math.cos(alat * R) * Math.cos(blat * R) * Math.sin(((blon - alon) * R) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
