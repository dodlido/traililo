// Reads a GPX file (the format hiking apps export) into the line shape the map draws.
export interface ParsedTrack {
  lines: number[][][];
  km: number;
  name: string;
  /** Total climb in metres, when the file has elevations. */
  gain?: number;
}

const rad = Math.PI / 180;
function dist(a: number[], b: number[]) {
  const dx = (b[0] - a[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * rad);
  const dy = (b[1] - a[1]) * 110.57;
  return Math.hypot(dx, dy);
}

/** Ramer-Douglas-Peucker, iterative so a long track cannot overflow the stack. */
export function simplify(pts: number[][], eps: number): number[][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [x1, y1] = pts[s];
    const [x2, y2] = pts[e];
    const den = Math.hypot(y2 - y1, x2 - x1) || 1e-12;
    let dmax = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((y2 - y1) * pts[i][0] - (x2 - x1) * pts[i][1] + x2 * y1 - y2 * x1) / den;
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (idx >= 0 && dmax > eps) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function parseGpx(text: string, fallbackName: string): ParsedTrack {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That does not look like a GPX file');
  const lines: number[][][] = [];
  const raw: { p: number[]; ele?: number }[][] = [];
  const read = (nodes: Element[]) => {
    const seg: { p: number[]; ele?: number }[] = [];
    for (const n of nodes) {
      const lat = parseFloat(n.getAttribute('lat') ?? '');
      const lon = parseFloat(n.getAttribute('lon') ?? '');
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const ele = parseFloat(n.getElementsByTagName('ele')[0]?.textContent ?? '');
      seg.push({ p: [lon, lat], ele: isFinite(ele) ? ele : undefined });
    }
    if (seg.length > 1) raw.push(seg);
  };
  const segs = [...doc.getElementsByTagName('trkseg')];
  if (segs.length) for (const s of segs) read([...s.getElementsByTagName('trkpt')]);
  else for (const r of [...doc.getElementsByTagName('rte')]) read([...r.getElementsByTagName('rtept')]);
  if (!raw.length) throw new Error('No track found in that file');

  let km = 0;
  let gain = 0;
  let haveEle = false;
  for (const seg of raw) {
    const pts = seg.map((s) => s.p);
    for (let i = 1; i < pts.length; i++) km += dist(pts[i - 1], pts[i]);
    // climb: ignore wiggles under 3 m, which a phone's altimeter makes up
    let base: number | undefined;
    for (const s of seg) {
      if (s.ele === undefined) continue;
      haveEle = true;
      if (base === undefined) base = s.ele;
      else if (s.ele - base >= 3) {
        gain += s.ele - base;
        base = s.ele;
      } else if (base - s.ele >= 3) base = s.ele;
    }
    let eps = 0.00003;
    let out = simplify(pts, eps);
    while (out.length > 1500 && eps < 0.001) {
      eps *= 1.6;
      out = simplify(pts, eps);
    }
    lines.push(out.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]));
  }
  const name = (doc.querySelector('trk > name, rte > name, metadata > name')?.textContent ?? '').trim() || fallbackName;
  return { lines, km: Math.round(km * 10) / 10, name, gain: haveEle ? Math.round(gain) : undefined };
}
