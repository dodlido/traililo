// Look of the map's places: one colour and one small drawing per kind of place.
import type { Entry, PoiCat } from './model.ts';

export type Cat = PoiCat | 'hike' | 'stay' | 'camp';

export const CATS: Record<Cat, { label: string; color: string; glyph: string; fill?: boolean }> = {
  stay: { label: 'Where you sleep', color: '#d6a8ff', fill: true, glyph: 'M3 18V6h2v7h7V9h6a3 3 0 0 1 3 3v6h-2v-2H5v2zM7.5 9.2a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z' },
  camp: { label: 'Camp', color: '#8ee07a', glyph: 'M3.5 20 12 6l8.5 14M2 20h20M12 6V3.5M9 20l3-6.5 3 6.5' },
  hike: { label: 'Hike', color: '#f2b24b', fill: true, glyph: 'M2.5 19 9 8l4 6.2 2.3-3.4L21.5 19z' },
  view: { label: 'Viewpoint', color: '#7fd6c2', glyph: 'M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z' },
  lake: { label: 'Lake', color: '#5cb8ff', glyph: 'M3 8.5c3-3 6 3 9 0s6 3 9 0M3 14c3-3 6 3 9 0s6 3 9 0M3 19.5c3-3 6 3 9 0s6 3 9 0' },
  waterfall: { label: 'Waterfall', color: '#4fd1e8', glyph: 'M5 3v8m5-8v12m5-12v8m5-8v5M3 19c2-2.4 4 2.4 6 0s4 2.4 6 0 4 2.4 6 0' },
  water: { label: 'On the water', color: '#38a3ff', fill: true, glyph: 'M2.5 15h19l-3.5 4.5H6zM6 5l12 8' },
  thermal: { label: 'Hot springs', color: '#ff8fb1', glyph: 'M8 3.5c-2.4 3 2.4 4 0 7.5M13 3c-2.4 3 2.4 4 0 8M18 3.5c-2.4 3 2.4 4 0 7.5M3.5 15h17a8.5 5.5 0 0 1-17 0z' },
  bike: { label: 'Bike', color: '#c3e86a', glyph: 'M6 20a3.6 3.6 0 1 0 0-7.2A3.6 3.6 0 0 0 6 20zM18 20a3.6 3.6 0 1 0 0-7.2A3.6 3.6 0 0 0 18 20zM6 16.4l4-8.4h5.5l2.5 8.4M8.5 8H11' },
  transport: { label: 'Bus or boat', color: '#b6a4ff', glyph: 'M5 4.5h14v11.5H5zM5 11h14M8 20v-4m8 4v-4' },
  car: { label: 'Car', color: '#e4dccb', glyph: 'M3.5 16.5 5.5 9h13l2 7.5V20h-17zM3.5 16.5h17M7 13h.01M17 13h.01' },
  town: { label: 'Town', color: '#f4f1e8', glyph: 'M3.5 11.5 12 4l8.5 7.5V20h-17zM9.8 20v-6h4.4v6' },
  sight: { label: 'Experience', color: '#ff7a6b', fill: true, glyph: 'm12 3 2.7 6 6.3.6-4.8 4.2 1.5 6.2-5.7-3.3-5.7 3.3 1.5-6.2L3 9.6 9.3 9z' },
};

/** A tent for a camp, a bed for everywhere else. */
export const isCamp = (s: { type?: string; name: string }): boolean =>
  s.type === 'camp' || ((s.type === undefined || s.type === 'hotel' || s.type === 'other') && /\bcamp(?:ing|site|ground)?\b|\bcampamento\b/i.test(s.name));
export const stayCat = (s: { type?: string; name: string }): Cat => (isCamp(s) ? 'camp' : 'stay');

/** Which kind of place a planned activity is, by its type and wording. */
export function catOfEntry(e: Entry): Cat {
  if (e.kind === 'hike') return 'hike';
  const t = e.title;
  if (/kayak|boat|sail|navigat/i.test(t)) return 'water';
  if (/term(a|as)\b|hot spring|thermal/i.test(t)) return 'thermal';
  if (/bike|cycl|circuito/i.test(t)) return 'bike';
  if (/cable car|bus|ferry/i.test(t)) return 'transport';
  return 'sight';
}

const NS = 'http://www.w3.org/2000/svg';
/** A 24 by 24 drawing of the kind, as an SVG element. */
export function glyphSvg(cat: Cat): SVGElement {
  const c = CATS[cat];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', c.glyph);
  path.setAttribute('fill', c.fill ? 'currentColor' : 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', c.fill ? '1.4' : '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/** Drawings for the things that are not places: planes and boats. */
export const PLANE = 'M12 2l2 7 8 5v2l-8-2.5-.7 5.5 2.7 2v1l-4-1-4 1v-1l2.7-2-.7-5.5L2 16v-2l8-5z';
export const FERRY = 'M3 15l2 5h14l2-5zM12 4v8M12 6l5 5h-5';
export const BOAT = 'M2 14h20l-3 6H5zM7 14V9h8l2 5M10 9V4h3v5';
