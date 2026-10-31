// Numbers and groupings the viewer needs, all computed from the imported trip.
import type { Day, Entry, HikeEntry, Leg, Stay, Trip } from './model.ts';

export interface DayHiking {
  /** Planned (not optional) hiking distance that day. */
  km: number;
  /** Optional hikes with a distance, drawn as an outline on top. */
  optionalKm: number;
  /** At least one planned hike has no distance in the sheet. */
  missing: boolean;
  /** Distance came from the first of several route options. */
  approx: boolean;
}

export function hikingFor(day: Day): DayHiking {
  let km = 0;
  let optionalKm = 0;
  let missing = false;
  let approx = false;
  for (const e of day.entries) {
    if (e.kind !== 'hike') continue;
    const h = e as HikeEntry;
    let d = h.distanceKm;
    if (d === undefined && h.options?.length) {
      d = h.options[0].distanceKm;
      if (d !== undefined) approx = true;
    }
    if (h.optional) {
      if (d !== undefined) optionalKm += d;
    } else if (d === undefined) missing = true;
    else km += d;
  }
  return { km, optionalKm, missing, approx };
}

export interface RegionRun {
  region: string;
  country?: string;
  days: Day[];
  start: number; // index of the first day in the trip
}

/** Consecutive days in the same region, in order. */
export function regionRuns(trip: Trip): RegionRun[] {
  const runs: RegionRun[] = [];
  trip.days.forEach((d, i) => {
    const last = runs[runs.length - 1];
    if (last && last.region === d.region) last.days.push(d);
    else runs.push({ region: d.region, country: d.country, days: [d], start: i });
  });
  return runs;
}

export function stayById(trip: Trip): Map<string, Stay> {
  return new Map(trip.stays.map((s) => [s.id, s]));
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts });
const parse = (iso: string) => new Date(iso + 'T00:00:00Z');

export const dayOfMonth = (iso: string) => String(parse(iso).getUTCDate());
export const weekday = (iso: string) => fmt({ weekday: 'short' }).format(parse(iso));
export const monthShort = (iso: string) => fmt({ month: 'short' }).format(parse(iso));
export const longDate = (iso: string) => fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(parse(iso));
export const shortDate = (iso: string) => fmt({ day: 'numeric', month: 'short' }).format(parse(iso));

const ROAD_MODES = ['drive', 'bus', 'taxi'];
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? +m[1] * 60 + +m[2] : undefined; };
/** Adds minutes to a clock time; `days` is how many midnights it crossed. */
export function addMinutes(t: string, min: number): { time: string; days: number } | undefined {
  const a = toMin(t);
  if (a === undefined) return undefined;
  const tot = a + Math.round(min);
  const m = ((tot % 1440) + 1440) % 1440;
  return { time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, days: Math.floor(tot / 1440) };
}
/** When a leg starts and ends. A drive, bus or taxi ends when the travel time after its start has passed (inferred); a flight or ferry uses the end that was entered. */
export function legTimes(l: Pick<Leg, 'mode' | 'startTime' | 'endTime' | 'durationMin'>): { start?: string; end?: string; days: number; inferred: boolean } {
  if (ROAD_MODES.includes(l.mode)) {
    const e = l.startTime && l.durationMin ? addMinutes(l.startTime, l.durationMin) : undefined;
    return { start: l.startTime, end: e?.time, days: e?.days ?? 0, inferred: !!e };
  }
  const over = l.startTime && l.endTime && toMin(l.endTime)! < toMin(l.startTime)! ? 1 : 0;
  return { start: l.startTime, end: l.endTime, days: over, inferred: false };
}
/** "08:00 to 10:30", or "08:00" alone, with +1 after an end on the next day. */
export function timeSpan(start?: string, end?: string, days = 0): string | undefined {
  if (!start && !end) return undefined;
  const e = end ? `${end}${days > 0 ? ` +${days}` : ''}` : undefined;
  return start && e ? `${start} to ${e}` : (start ?? e);
}
export function minutes(min?: number): string | undefined {
  if (min === undefined) return undefined;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

export function nightOf(stay: Stay, date: string): string | undefined {
  const idx = Math.round((parse(date).getTime() - parse(stay.checkIn).getTime()) / 86400000);
  return stay.nights > 1 ? `night ${idx + 1} of ${stay.nights}` : undefined;
}

export const kindLabel: Record<Entry['kind'], string> = {
  commute: 'Travel',
  hike: 'Hike',
  experience: 'Experience',
  note: 'Note',
  meal: 'Restaurant',
  hang: 'Night out',
};

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export const countryName = new Proxy({} as Record<string, string>, {
  get: (_t, code: string) => {
    try {
      return regionNames?.of(code.toUpperCase()) ?? code;
    } catch {
      return code;
    }
  },
});
