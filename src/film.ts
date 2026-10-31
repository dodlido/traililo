// The trip as a film: a list of scenes worked out from the trip, in the order they happened. A scene is a move along a real
// road (or a ferry line, or a flight), a stop (a meal, a hike, a visit), a night, or a title. Pictures are matched to the
// scene they were taken in by the time on them, and each day's journal is laid over the last scene of the day.
// Everything here is pure: the player (Film.tsx) only asks "what is happening at time t".
import type { CommuteEntry, Day, DrivePhoto, Entry, Leg, Point, Stay, Trip } from './model.ts';
import { catOfEntry, CATS, type Cat } from './mapkit.ts';

export type Mode = 'drive' | 'bus' | 'taxi' | 'ferry' | 'flight';
export type LngLat = [number, number];

export interface Odo {
  km: number;
  hike: number;
  climb: number;
  photos: number;
}
interface Base {
  /** Milliseconds from the start of the film. */
  start: number;
  dur: number;
  /** Index into `days`. */
  day: number;
  /** Totals when the scene begins, and how much it adds. */
  odo: Odo;
  add: Odo;
}
export interface TitleScene extends Base {
  kind: 'title';
}
export interface DayScene extends Base {
  kind: 'day';
  date: string;
  n: number;
  total: number;
  region: string;
  country?: string;
  at: Point;
  heading: number;
}
export interface Shot {
  photo: DrivePhoto;
  /** How far along the move it was taken, 0 to 1. */
  at: number;
}
export interface MoveScene extends Base {
  kind: 'move';
  mode: Mode;
  path: LngLat[];
  /** Kilometres along the path at each point. */
  cum: number[];
  km: number;
  from: string;
  to: string;
  mins?: number;
  shots: Shot[];
  /** Drawn as a straight line because no road was found for it. */
  approx: boolean;
}
export interface StopScene extends Base {
  kind: 'stop' | 'night';
  cat: Cat;
  title: string;
  eyebrow: string;
  facts: string[];
  at: Point;
  photos: DrivePhoto[];
  text?: string;
  heading: number;
  /** A hike or a drive-up view: the camera stays further out. */
  wide: boolean;
  /** The pictures taken here, before any were left out to keep the film short. */
  taken: number;
  /** A hike's distance and climb, counted up while the scene plays. */
  hikeKm: number;
  climb: number;
}
export interface EndScene extends Base {
  kind: 'end';
}
export type Scene = TitleScene | DayScene | MoveScene | StopScene | EndScene;

export interface DayMark {
  date: string;
  n: number;
  region: string;
  start: number;
  end: number;
}
export interface Film {
  scenes: Scene[];
  total: number;
  days: DayMark[];
  /** Every move, as faint dashes for the road still ahead. */
  roads: { path: LngLat[]; mode: Mode }[];
  bounds: [LngLat, LngLat] | null;
  totals: Odo;
  empty: boolean;
  /** How the pictures found their scene: by where they were taken, or by when. */
  placed: { location: number; time: number };
}

// ------------------------------------------------------------------ geometry

const R = Math.PI / 180;
export function kmBetween(a: Point | LngLat, b: Point | LngLat): number {
  const [alon, alat] = Array.isArray(a) ? a : [a.lon, a.lat];
  const [blon, blat] = Array.isArray(b) ? b : [b.lon, b.lat];
  const h = Math.sin(((blat - alat) * R) / 2) ** 2 + Math.cos(alat * R) * Math.cos(blat * R) * Math.sin(((blon - alon) * R) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Compass bearing from a to b, 0 to 360. */
export function bearing(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * R);
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) / R + 360) % 360;
}
const lonlat = (p: Point): LngLat => [p.lon, p.lat];

/** A flight is a gentle arc, the same one the map draws. */
function arc(a: Point, b: Point): LngLat[] {
  const mx = (a.lon + b.lon) / 2;
  const my = (a.lat + b.lat) / 2;
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const cx = mx - dy * 0.2;
  const cy = my + dx * 0.2;
  return Array.from({ length: 49 }, (_, i) => {
    const t = i / 48;
    const u = 1 - t;
    return [u * u * a.lon + 2 * u * t * cx + t * t * b.lon, u * u * a.lat + 2 * u * t * cy + t * t * b.lat] as LngLat;
  });
}

function cumulative(path: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + kmBetween(path[i - 1], path[i]));
  return out;
}

/** The spot `s` kilometres along a path. */
export function pointAt(path: LngLat[], cum: number[], s: number): LngLat {
  if (path.length === 1 || s <= 0) return path[0];
  const total = cum[cum.length - 1];
  if (s >= total) return path[path.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const t = span > 0 ? (s - cum[lo]) / span : 0;
  return [path[lo][0] + (path[hi][0] - path[lo][0]) * t, path[lo][1] + (path[hi][1] - path[lo][1]) * t];
}
/** Which way the road runs around `s`, smoothed over a stretch so a twisting road does not spin the camera. */
export function headingAt(path: LngLat[], cum: number[], s: number, span: number): number {
  const total = cum[cum.length - 1];
  const a = pointAt(path, cum, Math.max(0, s - span));
  const b = pointAt(path, cum, Math.min(total, s + span));
  if (a[0] === b[0] && a[1] === b[1]) return bearing(path[0], path[path.length - 1]);
  return bearing(a, b);
}
/** The part of the path from the start up to `s` kilometres. */
export function pathUpTo(path: LngLat[], cum: number[], s: number): LngLat[] {
  if (s <= 0) return [path[0], path[0]];
  const out: LngLat[] = [];
  for (let i = 0; i < path.length && cum[i] <= s; i++) out.push(path[i]);
  out.push(pointAt(path, cum, s));
  return out.length > 1 ? out : [path[0], out[0]];
}

// ------------------------------------------------------------------ times

const minOf = (t?: string): number | undefined => {
  const m = t && /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};
const takenMin = (p: DrivePhoto): number | undefined => (p.taken ? minOf(p.taken.slice(11, 16)) : undefined);

interface Span {
  t0?: number;
  t1?: number;
}
function spanOfLeg(l: Leg): Span {
  const t0 = minOf(l.startTime);
  const t1 = minOf(l.endTime) ?? (t0 !== undefined && l.durationMin ? t0 + l.durationMin : undefined);
  return { t0, t1 };
}
function spanOfEntry(e: Entry): Span {
  if (e.kind === 'meal' || e.kind === 'hang') {
    const t0 = minOf(e.time);
    return { t0, t1: t0 !== undefined ? t0 + 75 : undefined };
  }
  if (e.kind === 'experience') {
    const t0 = minOf(e.startTime);
    return { t0, t1: minOf(e.endTime) ?? (t0 !== undefined ? t0 + (e.durationMin ?? 90) : undefined) };
  }
  if (e.kind === 'hike') {
    const t0 = minOf(e.startTime);
    const guess = e.durationMin ?? Math.round(((e.distanceKm ?? 4) / 3.5 + (e.elevationGainM ?? 0) / 450) * 60);
    return { t0, t1: minOf(e.endTime) ?? (t0 !== undefined ? t0 + guess : undefined) };
  }
  return {};
}

// ------------------------------------------------------------------ building

interface Item {
  kind: 'move' | 'stop';
  span: Span;
  est: number;
  move?: Omit<MoveScene, keyof Base | 'shots'>;
  stop?: { cat: Cat; title: string; eyebrow: string; facts: string[]; at: Point; wide: boolean; hikeKm: number; climb: number };
  photos: DrivePhoto[];
  /** A journal entry: pictures are pinned to it and none are matched in by time. */
  pinned?: boolean;
  text?: string;
}

const SAME_PLACE_KM = 0.4;

function modeOf(m: Leg['mode']): Mode {
  return m === 'ferry' ? 'ferry' : m === 'flight' ? 'flight' : m === 'bus' ? 'bus' : m === 'taxi' ? 'taxi' : 'drive';
}
const modeLabel: Record<Mode, string> = { drive: 'Drive', bus: 'Bus', taxi: 'Taxi', ferry: 'Ferry', flight: 'Flight' };
export const labelOfMode = (m: Mode) => modeLabel[m];

function moveFrom(a: Point, b: Point, mode: Mode, from: string, to: string, leg?: Leg): NonNullable<Item['move']> {
  let path: LngLat[];
  let approx = false;
  if (leg?.path && leg.path.length > 1) path = leg.path;
  else if (mode === 'flight') path = arc(a, b);
  else {
    path = [lonlat(a), lonlat(b)];
    approx = true;
  }
  const cum = cumulative(path);
  const km = leg?.distanceKm ?? cum[cum.length - 1];
  return { kind: 'move', mode, path, cum, km: Math.max(km, 0.01), from, to, mins: leg?.durationMin, approx };
}

const short = (s: string) => s.split(/[,·:]| - /)[0].trim() || s;

function factsOf(e: Entry): string[] {
  const out: string[] = [];
  if (e.kind === 'hike') {
    if (e.startTime) out.push(e.startTime);
    if (e.distanceKm) out.push(`${Math.round(e.distanceKm * 10) / 10} km`);
    if (e.elevationGainM) out.push(`+${e.elevationGainM.toLocaleString('en-GB')} m`);
  } else if (e.kind === 'experience') {
    if (e.startTime) out.push(e.endTime ? `${e.startTime} to ${e.endTime}` : e.startTime);
  } else if (e.kind === 'meal' || e.kind === 'hang') {
    if (e.time) out.push(e.time);
    if (e.partySize) out.push(e.kind === 'meal' ? `table for ${e.partySize}` : `${e.partySize} ${e.partySize === 1 ? 'person' : 'people'}`);
  }
  return out;
}

/** Evenly spaced picks, in the same order, when there are more than we have room for. */
function pick<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / Math.max(1, n - 1))]);
}

const byTaken = (a: DrivePhoto, b: DrivePhoto) => (a.taken ?? '').localeCompare(b.taken ?? '') || a.name.localeCompare(b.name);

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
/** The journal as it is read on screen: a few sentences, not the whole day. */
export function readable(text: string, max = 340): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop >= 80) return cut.slice(0, stop + 1);
  const sp = cut.lastIndexOf(' ');
  return cut.slice(0, sp > 80 ? sp : max).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

/** Hands each picture to the scene it was taken in. Scenes with a time are anchored; those without are spread between their neighbours. */
function assignPhotos(items: Item[], photos: DrivePhoto[]): DrivePhoto[] {
  const left: DrivePhoto[] = [];
  if (!photos.length) return left;
  const timed = photos.filter((p) => takenMin(p) !== undefined).sort(byTaken);
  left.push(...photos.filter((p) => takenMin(p) === undefined));
  if (!items.length) return [...left, ...timed];

  // an estimated start for every scene: known ones keep theirs, the rest are spread between their neighbours
  const n = items.length;
  const est: (number | undefined)[] = items.map((it) => it.span.t0);
  let runningMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (est[i] !== undefined) {
      est[i] = Math.max(est[i]!, runningMax);
      runningMax = est[i]!;
    }
  }
  let i = 0;
  while (i < n) {
    if (est[i] !== undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && est[j] === undefined) j++;
    const prev = i > 0 ? (items[i - 1].span.t1 ?? est[i - 1]!) : undefined;
    const next = j < n ? est[j] : undefined;
    const k = j - i;
    for (let q = 0; q < k; q++) {
      if (prev !== undefined && next !== undefined) est[i + q] = prev + ((q + 1) / (k + 1)) * Math.max(0, next - prev);
      else if (next !== undefined) est[i + q] = -Infinity;
      else if (prev !== undefined) est[i + q] = Math.max(prev, runningMax) + 90 * (q + 1);
      else est[i + q] = undefined;
    }
    i = j;
  }

  if (est.every((x) => x === undefined)) {
    // nothing on the day has a time: share the pictures out between the stops in the order they were taken
    const stops = items.filter((it) => it.kind === 'stop');
    const targets = stops.length ? stops : items;
    timed.forEach((p, idx) => targets[Math.min(targets.length - 1, Math.floor((idx / timed.length) * targets.length))].photos.push(p));
    return left;
  }
  items.forEach((it, idx) => (it.est = est[idx] ?? -Infinity));
  const lastEnd = Math.max(...items.map((it) => it.span.t1 ?? it.est), -Infinity) + 120;
  for (const p of timed) {
    const t = takenMin(p)!;
    if (t > lastEnd) {
      left.push(p);
      continue;
    }
    let at = 0;
    for (let k = 0; k < n; k++) if (items[k].est <= t) at = k;
    items[at].photos.push(p);
  }
  return left;
}

/** Distance in km from a spot to the nearest point on a line. */
function toPath(p: { lat: number; lon: number }, path: LngLat[]): number {
  const k = Math.cos(p.lat * R);
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const ax = (path[i][0] - p.lon) * k * 111.32;
    const ay = (path[i][1] - p.lat) * 110.57;
    const bx = (path[Math.min(i + 1, path.length - 1)][0] - p.lon) * k * 111.32;
    const by = (path[Math.min(i + 1, path.length - 1)][1] - p.lat) * 110.57;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * Pictures that know where they were taken go to the nearest scene that is close enough (a stop, a stretch of road, or the
 * place of the night). The rest, and any that are not near anything, are left for the time matching.
 */
function placeByLocation(items: Item[], night: Point | undefined, photos: DrivePhoto[], where: (p: DrivePhoto) => Point | undefined): { rest: DrivePhoto[]; night: DrivePhoto[]; done: number } {
  const rest: DrivePhoto[] = [];
  const atNight: DrivePhoto[] = [];
  let done = 0;
  for (const p of photos) {
    const w = where(p);
    if (!w) {
      rest.push(p);
      continue;
    }
    let best: { score: number; to: Item | 'night' } | null = null;
    const consider = (d: number, limit: number, to: Item | 'night') => {
      if (d > limit) return;
      const score = d / limit;
      if (!best || score < best.score) best = { score, to };
    };
    for (const it of items) {
      if (it.move) consider(toPath(w, it.move.path), 0.4, it);
      else if (it.stop) consider(kmBetween(w, it.stop.at), it.stop.at.approx ? 6 : it.stop.wide ? 2.5 : 1.2, it);
    }
    if (night) consider(kmBetween(w, night), 0.5, 'night');
    const b = best as { score: number; to: Item | 'night' } | null;
    if (!b) rest.push(p);
    else {
      done++;
      if (b.to === 'night') atNight.push(p);
      else b.to.photos.push(p);
    }
  }
  return { rest, night: atNight, done };
}

export interface FilmOptions {
  /** Where pictures were taken, found afterwards for pictures that were saved without it. */
  locations?: Map<string, { lat: number; lon: number }>;
  /** Leave the pictures out (not signed in to Google). */
  photos?: boolean;
  /** Seconds the film should roughly last at most. */
  budget?: number;
}

const zero = (): Odo => ({ km: 0, hike: 0, climb: 0, photos: 0 });

export function buildFilm(trip: Trip, upTo: string, opts: FilmOptions = {}): Film {
  const withPhotos = opts.photos !== false;
  const days = trip.days.filter((d) => d.date <= upTo);
  const stays = new Map<string, Stay>(trip.stays.map((s) => [s.id, s]));
  const total = days.length;
  const cap = total <= 4 ? 8 : total <= 10 ? 6 : total <= 20 ? 4 : 3;
  const shotCap = total <= 10 ? 4 : 2;
  // a long trip gets shorter scenes, so it still plays in a few minutes
  const crowd = total <= 6 ? 1 : total <= 14 ? 0.8 : 0.6;
  const budget = (opts.budget ?? Math.max(60, Math.min(210, 42 + 8 * total))) * 1000;

  type Draft = { scene: Scene; nat: number; min: number; fixed?: boolean };
  const drafts: Draft[] = [];
  const dayStarts: number[] = [];
  const blank = (day: number): Base => ({ start: 0, dur: 0, day, odo: zero(), add: zero() });
  const push = (scene: Scene, nat: number, min: number, fixed = false) => drafts.push({ scene, nat, min, fixed });

  push({ kind: 'title', ...blank(0) }, 6000, 6000, true);

  let cur: Point | undefined;
  let curName = '';
  let heading = 24;
  let lastStayId: string | undefined;
  let placedByLocation = 0;
  let placedByTime = 0;

  days.forEach((day, di) => {
    const stay = day.stayId ? stays.get(day.stayId) : undefined;
    const sp = stay?.point ?? day.point;
    const items: Item[] = [];
    const goTo = (p: Point, name: string, mode: Mode = 'drive') => {
      if (cur && kmBetween(cur, p) > SAME_PLACE_KM) {
        const m = kmBetween(cur, p) > 350 ? 'flight' : mode;
        items.push({ kind: 'move', span: {}, est: 0, move: moveFrom(cur, p, m, short(curName), short(name)), photos: [] });
      }
      cur = p;
      curName = name;
    };

    for (const e of day.entries) {
      if (e.kind === 'commute') {
        for (const l of (e as CommuteEntry).legs) {
          const a = l.fromPoint ?? (l.path ? { lon: l.path[0][0], lat: l.path[0][1] } : cur);
          const b = l.toPoint ?? (l.path ? { lon: l.path[l.path.length - 1][0], lat: l.path[l.path.length - 1][1] } : undefined);
          if (!b) continue;
          const from = l.from ?? curName ?? '';
          const to = l.to ?? e.title;
          if (!a) {
            cur = b;
            curName = to;
            continue;
          }
          // a start somewhere other than where we are: get there first
          if (cur && kmBetween(cur, a) > 2) goTo(a, from);
          const mv = moveFrom(a, b, modeOf(l.mode), short(from), short(to), l);
          items.push({ kind: 'move', span: spanOfLeg(l), est: 0, move: mv, photos: [] });
          cur = b;
          curName = to;
        }
        continue;
      }
      if (e.kind === 'journal') {
        const here = cur ?? sp;
        if (!here) continue;
        const mine = withPhotos ? (day.drivePhotos ?? []).filter((p) => e.photoIds?.includes(p.id)).sort(byTaken) : [];
        items.push({ kind: 'stop', span: {}, est: 0, pinned: true, text: e.text.trim() ? readable(e.text) : undefined, stop: { cat: 'town', title: e.title, eyebrow: 'Journal', facts: [], at: here, wide: false, hikeKm: 0, climb: 0 }, photos: mine });
        continue;
      }
      if (e.kind === 'note' || e.optional) continue;
      const at = e.at ?? cur ?? sp;
      if (!at) continue;
      goTo(at, e.title);
      const hike = e.kind === 'hike';
      items.push({
        kind: 'stop',
        span: spanOfEntry(e),
        est: 0,
        stop: { cat: catOfEntry(e), title: e.title, eyebrow: CATS[catOfEntry(e)].label, facts: factsOf(e), at, wide: hike, hikeKm: hike ? (e.distanceKm ?? 0) : 0, climb: hike ? (e.elevationGainM ?? 0) : 0 },
        photos: [],
      });
    }
    if (!cur && sp) {
      cur = sp;
      curName = stay?.name ?? day.region;
    }
    if (sp && cur) goTo(sp, stay?.name ?? day.region);

    const pinnedIds = new Set(day.entries.flatMap((e) => (e.kind === 'journal' ? (e.photoIds ?? []) : [])));
    const photos = withPhotos ? (day.drivePhotos ?? []).filter((p) => !pinnedIds.has(p.id)) : [];
    const live = items.filter((it) => !it.pinned);
    const byWhere = placeByLocation(live, sp ?? cur, photos, (p) => (p.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : opts.locations?.get(p.id)));
    const leftover = [...byWhere.night, ...assignPhotos(live, byWhere.rest)].sort(byTaken);
    placedByLocation += byWhere.done;
    placedByTime += photos.length - byWhere.done;

    // ----- the scenes of the day -----
    if (!cur) return;
    dayStarts.push(drafts.length);
    const firstAt = items.find((it) => it.kind === 'stop')?.stop?.at ?? (items[0]?.move ? { lon: items[0].move.path[0][0], lat: items[0].move.path[0][1] } : cur);
    push({ kind: 'day', ...blank(di), date: day.date, n: di + 1, total, region: day.region, country: day.country, at: firstAt, heading }, 2400, 1300);

    for (const it of items) {
      if (it.move) {
        const m = it.move;
        const natMs = m.mode === 'flight' ? 5000 + 450 * Math.sqrt(m.km) : m.mode === 'ferry' ? 4000 + 700 * Math.sqrt(m.km) : 2800 + 900 * Math.sqrt(m.km);
        const nat = Math.min(natMs, m.mode === 'drive' || m.mode === 'bus' || m.mode === 'taxi' ? 16000 : 14000);
        const span = it.span;
        const shots: Shot[] = pick(it.photos.sort(byTaken), shotCap).map((p, k, all) => {
          const t = takenMin(p);
          const f = span.t0 !== undefined && span.t1 !== undefined && span.t1 > span.t0 && t !== undefined ? (t - span.t0) / (span.t1 - span.t0) : (k + 1) / (all.length + 1);
          return { photo: p, at: Math.max(0.1, Math.min(0.88, f)) };
        });
        // pictures taken in the same minute do not all pop up at once
        shots.sort((a, b) => a.at - b.at);
        for (let k = 1; k < shots.length; k++) shots[k].at = Math.max(shots[k].at, Math.min(0.9, shots[k - 1].at + 0.14));
        heading = headingAt(m.path, m.cum, m.km, Math.max(0.3, m.km * 0.08));
        push({ ...(m as Omit<MoveScene, keyof Base | 'shots'>), ...blank(di), shots, kind: 'move' } as MoveScene, nat, 2400);
        continue;
      }
      const s = it.stop!;
      const shown = pick(it.photos.sort(byTaken), cap);
      const textMs = 0;
      const nat = 2200 + Math.max(shown.length * 1900, textMs);
      push({ kind: 'stop', ...blank(di), cat: s.cat, title: s.title, eyebrow: s.eyebrow, facts: s.facts, at: s.at, photos: shown, heading, wide: s.wide, taken: it.photos.length, hikeKm: s.hikeKm, climb: s.climb, ...(it.text ? { text: it.text } : {}) }, s.cat === 'hike' ? Math.max(nat, 3600) : nat, shown.length ? 2400 : 1500);
    }

    // the night: where the day's journal and any pictures from the evening go
    const journal = day.journal?.text?.trim() ? readable(day.journal.text) : '';
    const newStay = !!stay && stay.id !== lastStayId;
    const lastDay = di === days.length - 1;
    if (stay) lastStayId = stay.id;
    if (cur && (journal || leftover.length || newStay || (lastDay && stay))) {
      const shown = pick(leftover, cap);
      const nightNo = stay ? Math.max(1, Math.round((Date.parse(day.date) - Date.parse(stay.checkIn)) / 86400000) + 1) : 0;
      const title = stay ? (stay.type === 'home' ? 'Home' : stay.name) : day.region;
      const eyebrow = stay ? (stay.nights > 1 ? `Night ${nightNo} of ${stay.nights}` : 'The night') : 'End of the day';
      const textMs = journal ? Math.max(3000, Math.min(11000, words(journal) * 330)) : 0;
      const nat = 1900 + Math.max(shown.length * 1900, textMs);
      push({ kind: 'night', ...blank(di), cat: stay?.type === 'camp' ? 'camp' : 'stay', title, eyebrow, facts: [], at: cur, photos: shown, text: journal || undefined, heading, wide: false, taken: leftover.length, hikeKm: 0, climb: 0 }, nat, shown.length || journal ? 2600 : 1600);
    } else if (journal && drafts.length) {
      // no place to hold it: hang the words on the last stop of the day
      const last = [...drafts].reverse().find((d) => d.scene.kind === 'stop' && d.scene.day === di);
      if (last && last.scene.kind === 'stop') {
        last.scene.text = journal;
        last.nat = Math.max(last.nat, 1900 + Math.max(words(journal) * 330, 3000));
        last.min = Math.max(last.min, 2600);
      }
    }
  });

  // a stop that carries words needs time to read them
  for (const d of drafts) {
    const s = d.scene;
    if (s.kind === 'stop' && s.text) {
      d.nat = Math.max(d.nat, 1900 + Math.max(3000, Math.min(11000, words(s.text) * 330)));
    }
  }
  push({ kind: 'end', ...blank(Math.max(0, days.length - 1)) }, 9000, 9000, true);

  // ----- squeeze to the budget: scenes shrink together, but none below its own minimum -----
  const sum = (k: number) => drafts.reduce((n, d) => n + (d.fixed ? d.nat : Math.max(d.min * crowd, d.nat * k)), 0);
  let k = 1;
  if (sum(1) > budget) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (sum(mid) > budget) hi = mid;
      else lo = mid;
    }
    k = lo;
  }

  // ----- lay them out on the clock, with running totals -----
  const odo = zero();
  let at = 0;
  const marks: DayMark[] = [];
  const roads: Film['roads'] = [];
  const pts: LngLat[] = [];
  for (const d of drafts) {
    const s = d.scene;
    s.start = at;
    s.dur = Math.round(d.fixed ? d.nat : Math.max(d.min * crowd, d.nat * k));
    at += s.dur;
    s.odo = { ...odo };
    if (s.kind === 'move') {
      s.add = { km: s.km, hike: 0, climb: 0, photos: s.shots.length };
      roads.push({ path: s.path, mode: s.mode });
      pts.push(...s.path.filter((_, i) => i % Math.max(1, Math.floor(s.path.length / 40)) === 0));
    } else if (s.kind === 'stop' || s.kind === 'night') {
      s.add = { km: 0, hike: s.hikeKm, climb: s.climb, photos: s.photos.length };
      pts.push(lonlat(s.at));
    } else s.add = zero();
    odo.km += s.add.km;
    odo.hike += s.add.hike;
    odo.climb += s.add.climb;
    odo.photos += s.add.photos;
  }
  const scenes = drafts.map((d) => d.scene);
  const run = odo;

  // day marks for the scrubber
  for (const s of scenes) {
    if (s.kind !== 'day') continue;
    const last = marks[marks.length - 1];
    if (last) last.end = s.start;
    marks.push({ date: s.date, n: s.n, region: s.region, start: s.start, end: at });
  }
  const bounds: Film['bounds'] = pts.length ? [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]] : null;
  return { scenes, total: at, days: marks, roads, bounds, totals: run, empty: !scenes.some((s) => s.kind === 'move' || s.kind === 'stop' || s.kind === 'night'), placed: { location: placedByLocation, time: placedByTime } };
}

/** The scene playing at time t (ms). */
export function sceneAt(film: Film, t: number, hint = 0): number {
  const sc = film.scenes;
  let i = Math.max(0, Math.min(sc.length - 1, hint));
  while (i > 0 && t < sc[i].start) i--;
  while (i < sc.length - 1 && t >= sc[i].start + sc[i].dur) i++;
  return i;
}
