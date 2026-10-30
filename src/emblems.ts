// The little pictures that sit on the map: one badge per kind of place, drawn once and handed to MapLibre.
import type * as maplibregl from 'maplibre-gl';
import { BOAT, CATS, FERRY, PLANE, type Cat } from './mapkit.ts';

export type Look = 'm' | 'w';
const INK = '#2a170a';
const NIGHT = '#0b1418';
const S = 88;

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function badge(look: Look, color: string, glyph: string, filled: boolean, glyphColor: string): ImageData {
  const c = canvas(S);
  const g = c.getContext('2d')!;
  const edge = look === 'w' ? INK : NIGHT;
  if (look === 'w') {
    g.fillStyle = 'rgba(42,23,10,.5)';
    g.beginPath();
    g.arc(46, 47, 36, 0, 7);
    g.fill();
  }
  g.beginPath();
  g.arc(42, 42, 36, 0, 7);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = look === 'w' ? 6 : 5;
  g.strokeStyle = edge;
  g.stroke();
  g.setTransform(1.62, 0, 0, 1.62, 23, 23);
  const p = new Path2D(glyph);
  g.lineWidth = 2.1;
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = glyphColor;
  g.fillStyle = glyphColor;
  if (filled) g.fill(p);
  g.stroke(p);
  return g.getImageData(0, 0, S, S);
}

function plane(look: Look): ImageData {
  const c = canvas(64);
  const g = c.getContext('2d')!;
  g.setTransform(2.4, 0, 0, 2.4, 3, 3);
  const p = new Path2D(PLANE);
  g.lineJoin = 'round';
  g.lineWidth = 1.6;
  g.strokeStyle = look === 'w' ? INK : NIGHT;
  g.fillStyle = look === 'w' ? '#b3261e' : '#dce9ea';
  g.stroke(p);
  g.fill(p);
  return g.getImageData(0, 0, 64, 64);
}

function boat(look: Look): ImageData {
  const c = canvas(64);
  const g = c.getContext('2d')!;
  g.setTransform(2.4, 0, 0, 2.4, 3, 3);
  const p = new Path2D(BOAT);
  g.lineJoin = 'round';
  g.lineWidth = 1.5;
  g.strokeStyle = look === 'w' ? INK : NIGHT;
  g.fillStyle = look === 'w' ? '#1f5f8b' : '#dce9ea';
  g.stroke(p);
  g.fill(p);
  return g.getImageData(0, 0, 64, 64);
}

export function addEmblems(map: maplibregl.Map) {
  const put = (name: string, d: ImageData) => map.addImage(name, d, { pixelRatio: 2 });
  for (const look of ['m', 'w'] as Look[]) {
    const w = look === 'w';
    for (const [cat, c] of Object.entries(CATS) as [Cat, (typeof CATS)[Cat]][]) put(`cat-${cat}-${look}`, badge(look, c.color, c.glyph, !!c.fill, w ? INK : NIGHT));
    put(`stop-done-${look}`, badge(look, w ? '#b3261e' : '#dce9ea', CATS.town.glyph, false, w ? '#f3e3b8' : NIGHT));
    put(`stop-later-${look}`, badge(look, w ? '#f3e3b8' : NIGHT, CATS.town.glyph, false, w ? INK : '#8aa0a4'));
    put(`port-flight-${look}`, badge(look, w ? '#1f5f8b' : '#9a8cf0', PLANE, true, w ? '#f3e3b8' : NIGHT));
    put(`port-ferry-${look}`, badge(look, w ? '#1f5f8b' : '#9a8cf0', FERRY, false, w ? '#f3e3b8' : NIGHT));
    put(`plane-${look}`, plane(look));
    put(`boat-${look}`, boat(look));
  }
}
