// "Home": one place, set once for the whole account, that any trip can use as a place to sleep. The coordinates live in
// the account (they follow you between devices), never in a trip: a trip only says "Home", and the app fills in where
// that is while the owner is looking. Friends' copies get no position for it at all.
import { useEffect, useState } from 'react';
import type { Point, Trip } from './model.ts';
import { sb } from './backend.ts';

export interface Home {
  name: string;
  point: Point;
}

const KEY = 'traililo:home';
type Cached = { uid: string; home: Home | null };
const read = (): Cached | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Cached | null;
    return v && typeof v.uid === 'string' ? v : null;
  } catch {
    return null;
  }
};
let uidNow = read()?.uid ?? '';
let current: Home | null = read()?.home ?? null;
const subs = new Set<(h: Home | null) => void>();

function publish(h: Home | null) {
  current = h;
  try {
    localStorage.setItem(KEY, JSON.stringify({ uid: uidNow, home: h } satisfies Cached));
  } catch {
    /* fine without it */
  }
  subs.forEach((f) => f(h));
}

const valid = (h: unknown): h is Home => !!h && typeof h === 'object' && typeof (h as Home).name === 'string' && typeof (h as Home).point?.lat === 'number' && typeof (h as Home).point?.lon === 'number';

/** Reads the home saved in the account (falls back to what this phone remembers when offline). */
export async function loadHome(): Promise<void> {
  try {
    const { data } = await sb.auth.getSession();
    const u = data.session?.user;
    if (!u) return;
    const meta = u.user_metadata?.home as unknown;
    if (uidNow !== u.id) {
      // another account signed in on this phone: nothing carries over
      uidNow = u.id;
      publish(valid(meta) ? meta : null);
    } else if (valid(meta)) publish(meta);
  } catch {
    /* offline: keep what is remembered */
  }
}

/** Saves the home to the account. Returns an error message, or nothing when it went through. */
export async function saveHome(h: Home | null): Promise<string | undefined> {
  publish(h);
  try {
    const { error } = await sb.auth.updateUser({ data: { home: h } });
    if (error) return `Saved on this phone only: ${error.message}`;
  } catch {
    return 'Saved on this phone only. It will not follow you to other devices until you are online.';
  }
  return undefined;
}

export function useHome(): Home | null {
  const [h, setH] = useState<Home | null>(current);
  useEffect(() => {
    subs.add(setH);
    setH(current);
    void loadHome();
    return () => void subs.delete(setH);
  }, []);
  return h;
}

const homeIds = (t: Trip) => new Set(t.stays.filter((s) => s.type === 'home').map((s) => s.id));

/** The trip as the owner sees it: home stays, and the days spent at home, are placed at the account's home. */
export function withHome(t: Trip, home: Home | null): Trip {
  const ids = homeIds(t);
  if (!home || ids.size === 0) return t;
  return {
    ...t,
    stays: t.stays.map((s) => (ids.has(s.id) ? { ...s, point: home.point, location: home.name } : s)),
    days: t.days.map((d) => (d.stayId && ids.has(d.stayId) ? { ...d, point: home.point } : d)),
  };
}

/** Before a trip is saved: nothing at home carries a position, whatever the screen was showing. */
export function stripHome(t: Trip): void {
  const ids = homeIds(t);
  if (ids.size === 0) return;
  for (const s of t.stays) if (ids.has(s.id)) {
    delete s.point;
    delete s.location;
  }
  for (const d of t.days) if (d.stayId && ids.has(d.stayId)) delete d.point;
}
