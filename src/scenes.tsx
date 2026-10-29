// Illustrated landscapes, one per place. Drawn in code from a seeded random generator, so they are always the same.
// If you add a real photo at photos/<slug>.jpg next to index.html, it fades in over the drawing.
import { useId, useState, type ReactElement } from 'react';

export type Kind = 'city' | 'peaks' | 'towers' | 'spire' | 'glacier' | 'lake' | 'fjord' | 'volcano' | 'sea' | 'jagged';
export interface Theme {
  sky: [string, string];
  sun?: { x: number; y: number; c: string; r: number };
  stars?: boolean;
  layers: string[]; // far to near
  kind: Kind;
  water?: string;
  accent: string;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const THEMES: Record<string, Theme> = {
  'Buenos Aires': { sky: ['#2a1b3d', '#f08a5d'], sun: { x: 200, y: 150, c: '#ffd29a', r: 26 }, layers: ['#4a2a4f'], kind: 'city', accent: '#f2916b' },
  Ushuaia: { sky: ['#10213f', '#6d83b8'], sun: { x: 310, y: 62, c: '#f1f4ff', r: 13 }, stars: true, layers: ['#3b4f7d', '#26365c', '#16213d'], kind: 'peaks', water: '#0f1b33', accent: '#86a8ff' },
  'Punta Arenas': { sky: ['#3b4a5a', '#d2bfa0'], layers: ['#6b7886'], kind: 'sea', water: '#4b5f73', accent: '#d9c4a0' },
  'Puerto Natales': { sky: ['#1e3552', '#f1b48b'], sun: { x: 120, y: 140, c: '#ffd9a8', r: 20 }, layers: ['#4b5d78', '#2d3d56'], kind: 'lake', water: '#2b4766', accent: '#f4b995' },
  'Torres del Paine': { sky: ['#2b2a52', '#ff9a62'], sun: { x: 90, y: 128, c: '#ffe0a0', r: 24 }, layers: ['#6a4f6f', '#3e2f4d'], kind: 'towers', water: '#3c5a7a', accent: '#ff9f68' },
  'El Calafate': { sky: ['#17345a', '#bfe6f0'], sun: { x: 305, y: 68, c: '#ffffff', r: 15 }, layers: ['#9fc7d6', '#5b95b0'], kind: 'glacier', accent: '#8fe3f2' },
  'El Chalten': { sky: ['#3a2352', '#ff7a8a'], layers: ['#8a4f78', '#4a2d55', '#271a38'], kind: 'spire', accent: '#ff93a3' },
  'Lago Posadas': { sky: ['#0f3a47', '#7fe0d0'], sun: { x: 285, y: 90, c: '#fff3c0', r: 16 }, layers: ['#2c6f73', '#1b4c55'], kind: 'lake', water: '#2aa6a0', accent: '#52dcc8' },
  'Puerto Rio Tranquilo': { sky: ['#143a5a', '#9bd8e8'], layers: ['#3f7290', '#27506e'], kind: 'lake', water: '#2f86ad', accent: '#6fcdea' },
  'Villa Cerro Castillo': { sky: ['#2a2150', '#b58ad8'], stars: true, layers: ['#6a5a9a', '#42386d', '#251f45'], kind: 'jagged', accent: '#bba0f7' },
  Puyuhuapi: { sky: ['#233a35', '#a9c9a0'], layers: ['#3d6a55', '#264b3c', '#16301f'], kind: 'fjord', water: '#35594d', accent: '#93d49d' },
  Chaiten: { sky: ['#2a1f1c', '#e0875a'], layers: ['#4f3a30', '#2b211d'], kind: 'volcano', accent: '#f39a63' },
  'Puerto Montt': { sky: ['#26414f', '#d6c9a8'], layers: ['#4a6a73'], kind: 'sea', water: '#35525d', accent: '#e8dab4' },
  Bariloche: { sky: ['#1f3a2e', '#f0c36b'], sun: { x: 262, y: 118, c: '#ffe29a', r: 22 }, layers: ['#4f7a4a', '#2f5a3a', '#1b3a28'], kind: 'lake', water: '#2f5d58', accent: '#f3c971' },
};
export const COVER: Theme = { ...THEMES['Torres del Paine'], layers: ['#8a5a7a', '#5a3e65', '#33254a', '#1a1330'], sky: ['#1d1b46', '#ff8d6a'], stars: true, kind: 'spire', accent: '#ff9f68' };
export const themeFor = (region: string): Theme => THEMES[region] ?? THEMES['Puerto Natales'];

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 400;
const H = 240;

function ridge(r: () => number, base: number, amp: number, step: number, spiky: boolean, peaks: [number, number][] = []): string {
  const pts: [number, number][] = [];
  let y = base;
  for (let x = 0; x <= W + step; x += step) {
    y += (r() - 0.5) * amp * (spiky ? 1.9 : 1);
    y = base + (y - base) * 0.82;
    let yy = y;
    for (const [px, ph] of peaks) yy -= Math.max(0, ph * (1 - Math.abs(x - px) / (ph * 0.55)));
    pts.push([x, yy]);
  }
  return `M0 ${H} L` + pts.map(([x, yy]) => `${x.toFixed(1)} ${yy.toFixed(1)}`).join(' L') + ` L${W} ${H} Z`;
}

export function Scene({ region, theme, className = '', photo = true, seed }: { region: string; theme: Theme; className?: string; photo?: boolean; seed?: string }) {
  const id = useId().replace(/:/g, '');
  const [hasPhoto, setHasPhoto] = useState(false);
  const r = rng(seed ?? region);
  const t = theme;
  const horizon = t.kind === 'sea' || t.kind === 'lake' || t.kind === 'fjord' ? 168 : 190;
  const parts: ReactElement[] = [];

  if (t.stars) {
    const dots = Array.from({ length: 46 }, (_, i) => (
      <circle key={i} cx={r() * W} cy={r() * 120} r={0.4 + r() * 0.9} fill="#fff" opacity={0.35 + r() * 0.55} />
    ));
    parts.push(<g key="stars">{dots}</g>);
  }
  if (t.sun) {
    parts.push(<circle key="glow" cx={t.sun.x} cy={t.sun.y} r={t.sun.r * 4.2} fill={`url(#g${id})`} />);
    parts.push(<circle key="sun" cx={t.sun.x} cy={t.sun.y} r={t.sun.r} fill={t.sun.c} />);
  }

  const n = t.layers.length;
  t.layers.forEach((c, i) => {
    const base = horizon - 60 + i * (44 / Math.max(1, n));
    const spiky = t.kind === 'jagged' || t.kind === 'peaks' || t.kind === 'spire' || t.kind === 'glacier';
    let peaks: [number, number][] = [];
    if (i === n - 2 || (n === 1 && t.kind === 'towers')) {
      if (t.kind === 'towers') peaks = [[150, 70], [200, 92], [252, 66]];
      if (t.kind === 'spire') peaks = [[205, 96]];
      if (t.kind === 'volcano') peaks = [[240, 80]];
    }
    parts.push(<path key={`l${i}`} d={ridge(r, base, spiky ? 16 : 9, spiky ? 9 : 14, spiky, peaks)} fill={c} />);
  });

  if (t.kind === 'glacier') {
    parts.push(
      <path key="ice" d={`M0 ${H} L0 190 L60 176 L120 186 L190 170 L270 184 L340 172 L${W} 182 L${W} ${H} Z`} fill="#e6f6fb" opacity=".92" />,
      <path key="ice2" d={`M0 ${H} L0 212 L90 200 L180 210 L290 198 L${W} 208 L${W} ${H} Z`} fill="#bfe6f0" opacity=".9" />,
    );
  }
  if (t.kind === 'volcano') {
    parts.push(<path key="smoke" d="M236 108c-14-10-6-24 8-24s22-14 10-26c14-4 30 6 22 20-6 10 4 14 10 20-18 8-34 14-50 10z" fill="#fff" opacity=".12" />);
  }
  if (t.kind === 'city') {
    const b = Array.from({ length: 24 }, (_, i) => {
      const w = 10 + r() * 16;
      const h = 24 + r() * 76;
      const x = i * 17 + r() * 6;
      return (
        <g key={i}>
          <rect x={x} y={H - 30 - h} width={w} height={h + 30} fill="#2a1836" />
          {Array.from({ length: Math.floor(h / 12) }, (_, j) => (r() > 0.55 ? <rect key={j} x={x + 3 + r() * (w - 8)} y={H - 26 - h + j * 12} width="2.4" height="3.4" fill="#ffd29a" opacity=".85" /> : null))}
        </g>
      );
    });
    parts.push(<g key="city">{b}</g>);
  }
  if (t.water) {
    parts.push(
      <rect key="water" x="0" y={horizon + 6} width={W} height={H} fill={t.water} />,
      <rect key="wsheen" x="0" y={horizon + 6} width={W} height="26" fill={`url(#w${id})`} />,
    );
    if (t.sun) {
      for (let i = 0; i < 6; i++)
        parts.push(<rect key={`s${i}`} x={t.sun.x - 26 + i * 4 + r() * 6} y={horizon + 12 + i * 9} width={52 - i * 7} height="1.6" rx=".8" fill={t.sun.c} opacity={0.5 - i * 0.07} />);
    }
  }
  parts.push(<rect key="vig" x="0" y={H - 70} width={W} height="70" fill={`url(#v${id})`} />);

  return (
    <div className={`scene ${className}`} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={t.sky[0]} />
            <stop offset="0.82" stopColor={t.sky[1]} />
          </linearGradient>
          <radialGradient id={`g${id}`}>
            <stop offset="0" stopColor={t.sun?.c ?? '#fff'} stopOpacity=".55" />
            <stop offset="1" stopColor={t.sun?.c ?? '#fff'} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`w${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".16" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`v${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b1418" stopOpacity="0" />
            <stop offset="1" stopColor="#0b1418" stopOpacity=".55" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#s${id})`} />
        {parts}
      </svg>
      {photo && (
        <img
          className={hasPhoto ? 'scene-photo is-in' : 'scene-photo'}
          src={`photos/${slug(region)}.jpg`}
          alt=""
          loading="lazy"
          onLoad={() => setHasPhoto(true)}
          onError={(e) => e.currentTarget.remove()}
        />
      )}
    </div>
  );
}
