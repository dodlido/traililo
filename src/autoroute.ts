// Finds the road (or the charted ferry line) for travel legs that are still drawn as a straight line.
import type { Point, Trip } from './model.ts';
import { routeRoad, type Road } from './roads.ts';
import { routeFerry } from './ferry.ts';

export interface Job {
  date: string;
  entry: string;
  leg: number;
  mode: string;
  from: Point;
  to: Point;
  label: string;
  /** Set for a drawn line of the trip rather than a leg of a travel entry. */
  line?: string;
  via?: Point[];
}
const ROUTED = ['drive', 'taxi', 'bus', 'ferry'];

export function roadJobs(trip: Trip): Job[] {
  const out: Job[] = [];
  trip.days.forEach((d, i) => {
    if ((trip.lines ?? []).some((l) => l.date === d.date && l.replace)) return;
    for (const e of d.entries) {
      if (e.kind !== 'commute') continue;
      e.legs.forEach((l, k) => {
        if (!ROUTED.includes(l.mode) || l.path || l.pathTried) return;
        const from = l.fromPoint ?? (e.legs.length === 1 ? trip.days[i - 1]?.point : undefined);
        const to = l.toPoint ?? (e.legs.length === 1 ? d.point : undefined);
        if (!from || !to || (from.lat === to.lat && from.lon === to.lon)) return;
        out.push({ date: d.date, entry: e.id, leg: k, mode: l.mode, from, to, label: `${d.date.slice(5)}: ${l.from ?? ''} to ${l.to ?? ''}`.replace(/ to $/, '') });
      });
    }
  });
  // lines drawn on the map by hand (from the planning map): follow the road or water between their points
  for (const l of trip.lines ?? []) {
    if (l.routed || !['drive', 'ferry'].includes(l.mode) || l.points.length < 2 || l.points.length > 12) continue;
    out.push({ date: l.date, entry: '', leg: -1, mode: l.mode, from: l.points[0], to: l.points[l.points.length - 1], via: l.points.slice(1, -1), line: l.id, label: `${l.date.slice(5)}: ${l.name}` });
  }
  return out;
}

/** Looks up one leg. Ferries with no charted line come back null and stay straight. */
export async function routeJob(j: Job): Promise<Road | null> {
  if (j.mode === 'ferry') return routeFerry(j.from, j.to);
  return routeRoad([j.from, ...(j.via ?? []), j.to]);
}

/** Writes what was found into the trip (a leg that found nothing is marked so it is not asked again every time). */
export function applyRoutes(t: Trip, found: { job: Job; r: Road | null }[]) {
  for (const { job, r } of found) {
    if (job.line) {
      const ln = t.lines?.find((x) => x.id === job.line);
      if (!ln) continue;
      ln.routed = true;
      ln.stops ??= [job.from, ...(job.via ?? []), job.to].map((point, i) => ({ name: `Point ${i + 1}`, point }));
      if (r) ln.points = r.path.map(([lon, lat]) => ({ lon, lat }));
      continue;
    }
    const e = t.days.find((d) => d.date === job.date)?.entries.find((q) => q.id === job.entry);
    if (e?.kind !== 'commute') continue;
    const l = e.legs[job.leg];
    l.fromPoint = job.from;
    l.toPoint = job.to;
    if (!r) {
      l.pathTried = true;
      continue;
    }
    l.path = r.path;
    if (l.distanceKm === undefined) l.distanceKm = r.km;
    if (l.durationMin === undefined) l.durationMin = r.min;
  }
}
