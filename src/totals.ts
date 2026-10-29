import type { CommuteEntry, HikeEntry, Trip, TripTotals } from './model.ts';

export function computeTotals(trip: Trip): TripTotals {
  const hikes = trip.days.flatMap((d) => d.entries.filter((e): e is HikeEntry => e.kind === 'hike'));
  const planned = hikes.filter((h) => !h.optional);
  const legs = trip.days.flatMap((d) => d.entries.filter((e): e is CommuteEntry => e.kind === 'commute').flatMap((c) => c.legs));
  return {
    days: trip.days.length,
    nights: trip.stays.reduce((n, s) => n + s.nights, 0),
    hikes: planned.length,
    optionalHikes: hikes.length - planned.length,
    hikesMissingDistance: planned.filter((h) => h.distanceKm === undefined).length,
    hikeDistanceKm: Math.round(planned.reduce((n, h) => n + (h.distanceKm ?? 0), 0) * 10) / 10,
    hikeElevationGainM: planned.reduce((n, h) => n + (h.elevationGainM ?? 0), 0),
    knownTravelMin: legs.reduce((n, l) => n + (l.durationMin ?? 0), 0),
    flights: legs.filter((l) => l.mode === 'flight').length,
    ferries: legs.filter((l) => l.mode === 'ferry').length,
    countries: new Set(trip.days.map((d) => d.country).filter(Boolean)).size,
    stays: trip.stays.length,
    openTodos: trip.days.reduce((n, d) => n + d.todos.filter((t) => !t.done).length, 0),
  };
}
