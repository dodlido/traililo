// The trip recap, worked out from what is already in the trip: no starring and no choosing. It only looks at days up to
// today, so the same code gives "so far" during the trip and the full story afterwards.
import type { CommuteEntry, Day, DrivePhoto, HikeEntry, Point, Trip } from './model.ts';
import { countryName, hikingFor, minutes, regionRuns, shortDate, type RegionRun } from './derive.ts';
import { todayDate } from './today.ts';

export interface RecapStats {
  days: number;
  nights: number;
  places: number;
  countries: number;
  crossings: number;
  hikes: number;
  hikeKm: number;
  climbM: number;
  /** Straight-line distance between the places the nights were spent in. */
  stopsKm: number;
  flights: number;
  ferries: number;
  photos: number;
  written: number;
  words: number;
}

export interface Moment {
  /** Stable, so hiding one keeps it hidden. */
  key: string;
  icon: string;
  title: string;
  detail: string;
  date: string;
}

export interface RecapDay {
  day: Day;
  photos: DrivePhoto[];
  snippet: string;
}

export interface RecapChapter {
  idx: number;
  run: RegionRun;
  days: RecapDay[];
  cover?: DrivePhoto;
  photos: number;
  hikeKm: number;
}

export interface Recap {
  state: 'before' | 'during' | 'after';
  upTo: string;
  stats: RecapStats;
  moments: Moment[];
  hidden: Moment[];
  chapters: RecapChapter[];
  cover?: DrivePhoto;
  route: Point[];
}

const dayNo = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function km(a: Point, b: Point): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The first sentence or two of what was written, short enough to sit over a picture. */
export function snippetOf(text: string, max = 170): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop >= 40) return cut.slice(0, stop + 1);
  const sp = cut.lastIndexOf(' ');
  return cut.slice(0, sp > 40 ? sp : max).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

const byTaken = (a: DrivePhoto, b: DrivePhoto) => (a.taken ?? '').localeCompare(b.taken ?? '') || a.name.localeCompare(b.name);

export function computeRecap(trip: Trip, date = todayDate()): Recap {
  const first = trip.days[0]?.date ?? date;
  const last = trip.days[trip.days.length - 1]?.date ?? date;
  const state: Recap['state'] = date < first ? 'before' : date > last ? 'after' : 'during';
  const upTo = state === 'after' ? last : date;
  const days = state === 'before' ? [] : trip.days.filter((d) => d.date <= upTo);

  // a night counts once it is over, so tonight's is not in the "so far"
  const through = state === 'after' ? Infinity : dayNo(upTo) - 1;
  const nights = trip.stays.reduce((n, s) => n + Math.max(0, Math.min(s.nights, through - dayNo(s.checkIn) + 1)), 0);

  const hikes: { h: HikeEntry; day: Day }[] = [];
  let flights = 0;
  let ferries = 0;
  const travel: { day: Day; min: number }[] = [];
  for (const d of days) {
    let min = 0;
    for (const e of d.entries) {
      if (e.kind === 'hike' && !e.optional) hikes.push({ h: e, day: d });
      if (e.kind === 'commute') {
        for (const l of (e as CommuteEntry).legs) {
          if (l.mode === 'flight') flights++;
          if (l.mode === 'ferry') ferries++;
          min += l.durationMin ?? 0;
        }
      }
    }
    travel.push({ day: d, min });
  }

  const crossings: { day: Day; to: string }[] = [];
  days.forEach((d, i) => {
    const prev = days[i - 1]?.country;
    if (i > 0 && prev && d.country && prev !== d.country) crossings.push({ day: d, to: d.country });
  });

  const route: Point[] = [];
  for (const d of days) {
    const p = d.point;
    const lastP = route[route.length - 1];
    if (p && !(lastP && lastP.lat === p.lat && lastP.lon === p.lon)) route.push(p);
  }
  let stopsKm = 0;
  for (let i = 1; i < route.length; i++) stopsKm += km(route[i - 1], route[i]);

  const photoDays = days.filter((d) => d.drivePhotos?.length);
  const written = days.filter((d) => d.journal?.text.trim());
  const stats: RecapStats = {
    days: days.length,
    nights,
    places: new Set(days.map((d) => d.region)).size,
    countries: new Set(days.map((d) => d.country).filter(Boolean)).size,
    crossings: crossings.length,
    hikes: hikes.length,
    hikeKm: Math.round(days.reduce((n, d) => n + hikingFor(d).km, 0) * 10) / 10,
    climbM: hikes.reduce((n, x) => n + (x.h.elevationGainM ?? 0), 0),
    stopsKm: Math.round(stopsKm),
    flights,
    ferries,
    photos: photoDays.reduce((n, d) => n + (d.drivePhotos?.length ?? 0), 0),
    written: written.length,
    words: written.reduce((n, d) => n + words(d.journal!.text), 0),
  };

  // ----- the moments worth a mention -----
  const all: Moment[] = [];
  const longest = hikes.filter((x) => x.h.distanceKm !== undefined).sort((a, b) => b.h.distanceKm! - a.h.distanceKm!)[0];
  if (longest && longest.h.distanceKm! > 0) all.push({ key: `hike:${longest.h.id}`, icon: 'hike', title: 'Longest hike', detail: `${longest.h.title} · ${Math.round(longest.h.distanceKm! * 10) / 10} km`, date: longest.day.date });
  const climb = hikes.filter((x) => x.h.elevationGainM).sort((a, b) => b.h.elevationGainM! - a.h.elevationGainM!)[0];
  if (climb) all.push({ key: `climb:${climb.h.id}`, icon: 'hike', title: 'Biggest climb', detail: `${climb.h.title} · +${climb.h.elevationGainM!.toLocaleString('en-GB')} m`, date: climb.day.date });
  for (const c of crossings.slice(0, 3)) all.push({ key: `border:${c.day.date}`, icon: 'flag', title: `Crossed into ${countryName[c.to]}`, detail: `${c.day.region}`, date: c.day.date });
  const road = travel.filter((x) => x.min >= 240).sort((a, b) => b.min - a.min)[0];
  if (road) all.push({ key: `road:${road.day.date}`, icon: 'bus', title: 'Longest day on the road', detail: `${minutes(road.min)} of travel`, date: road.day.date });
  const stay = trip.stays.filter((s) => s.nights >= 3 && s.checkIn <= upTo && state !== 'before').sort((a, b) => b.nights - a.nights)[0];
  if (stay) all.push({ key: `stay:${stay.id}`, icon: 'bed', title: 'Longest stay', detail: `${stay.nights} nights · ${stay.name}`, date: stay.checkIn });
  const busy = [...photoDays].sort((a, b) => b.drivePhotos!.length - a.drivePhotos!.length)[0];
  if (busy && busy.drivePhotos!.length >= 3) all.push({ key: `photos:${busy.date}`, icon: 'image', title: 'Most photographed day', detail: `${busy.drivePhotos!.length} pictures · ${busy.region}`, date: busy.date });
  const story = [...written].sort((a, b) => words(b.journal!.text) - words(a.journal!.text))[0];
  if (story && words(story.journal!.text) >= 25) all.push({ key: `story:${story.date}`, icon: 'note', title: 'Most written day', detail: `${words(story.journal!.text)} words · ${story.region}`, date: story.date });
  all.sort((a, b) => a.date.localeCompare(b.date));
  const off = new Set(trip.recapHidden ?? []);

  // ----- chapters, with a cover picture each -----
  const chapters: RecapChapter[] = [];
  regionRuns(trip).forEach((run, idx) => {
    const mine = run.days.filter((d) => d.date <= upTo && state !== 'before');
    if (mine.length === 0) return;
    const rd: RecapDay[] = mine.map((d) => ({ day: d, photos: [...(d.drivePhotos ?? [])].sort(byTaken), snippet: d.journal?.text ? snippetOf(d.journal.text) : '' }));
    const best = [...rd].sort((a, b) => b.photos.length - a.photos.length)[0];
    chapters.push({
      idx,
      run,
      days: rd,
      cover: best && best.photos.length ? best.photos[Math.floor((best.photos.length - 1) / 2)] : undefined,
      photos: rd.reduce((n, d) => n + d.photos.length, 0),
      hikeKm: Math.round(mine.reduce((n, d) => n + hikingFor(d).km, 0) * 10) / 10,
    });
  });
  const lead = [...chapters].sort((a, b) => b.photos - a.photos)[0];

  return {
    state,
    upTo,
    stats,
    moments: all.filter((m) => !off.has(m.key)),
    hidden: all.filter((m) => off.has(m.key)),
    chapters,
    cover: lead?.cover,
    route,
  };
}

export const when = (m: Moment) => shortDate(m.date);
