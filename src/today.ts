// Where "today" falls in the trip: before it (a countdown), on one of its days, or after it.
import type { Trip } from './model.ts';

export interface Today {
  state: 'before' | 'during' | 'after';
  date: string;
  /** Index of today's day within the trip while it is under way. */
  idx: number;
  /** Day number, counting from 1. */
  n: number;
  total: number;
  daysTo: number;
  daysSince: number;
}

/** The phone's local date. Add ?today=2027-03-12 to the address to preview another day. */
export function todayDate(): string {
  try {
    const o = new URLSearchParams(location.search).get('today');
    if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
  } catch {
    /* no address bar to read */
  }
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dayNumber = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);

export function whereIsToday(trip: Trip, date = todayDate()): Today {
  const total = trip.days.length;
  const first = trip.days[0].date;
  const last = trip.days[total - 1].date;
  const base = { date, total, daysTo: Math.max(0, dayNumber(first) - dayNumber(date)), daysSince: Math.max(0, dayNumber(date) - dayNumber(last)) };
  if (date < first) return { ...base, state: 'before', idx: 0, n: 0 };
  if (date > last) return { ...base, state: 'after', idx: total - 1, n: total };
  const idx = trip.days.findIndex((d) => d.date === date);
  // a date that falls in no listed day (a gap) counts as the last day before it
  const at = idx >= 0 ? idx : Math.max(0, trip.days.filter((d) => d.date < date).length - 1);
  return { ...base, state: 'during', idx: at, n: at + 1 };
}
