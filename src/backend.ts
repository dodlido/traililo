// Everything that talks to the database. Trips live in Supabase; row-level rules decide who can read what:
//  - trips: the friends' version of a trip, readable by its members (after 2FA)
//  - trip_private: the full version with bookings and to-dos, readable by the owner only (after 2FA)
import { createClient, type Session } from '@supabase/supabase-js';
import type { ImportReport, Trip } from './model.ts';
import type { Tracks } from './MapView.tsx';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.ts';

// Invite and password-reset links arrive with tokens in the address; remember that before the client clears them.
export const NEEDS_NEW_PASSWORD = /[#&?]type=(invite|recovery)/.test(location.hash + location.search);

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export interface TripSummary {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  cover_region: string;
  owner: boolean;
}
export interface Bundle {
  id: string;
  title: string;
  owner: boolean;
  trip: Trip;
  tracks: Tracks;
  report?: ImportReport;
  sources?: Record<string, Record<string, string>>;
}

const cacheKey = (uid: string, what: string) => `traililo:${uid}:${what}`;
function cacheGet<T>(uid: string, what: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(uid, what));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function cachePut(uid: string, what: string, value: unknown) {
  try {
    localStorage.setItem(cacheKey(uid, what), JSON.stringify(value));
  } catch {
    /* storage full or blocked: skip */
  }
}
/** Forget the trips kept on this device (used when signing out). */
export function clearCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('traililo:')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export async function listTrips(session: Session): Promise<{ trips: TripSummary[]; offline: boolean }> {
  const uid = session.user.id;
  const { data, error } = await sb.from('trips').select('id,title,start_date,end_date,cover_region,owner_id').order('start_date', { ascending: false });
  if (error) {
    const cached = cacheGet<TripSummary[]>(uid, 'list');
    if (cached) return { trips: cached, offline: true };
    throw error;
  }
  const trips = (data ?? []).map((r) => ({ id: r.id, title: r.title, start_date: r.start_date, end_date: r.end_date, cover_region: r.cover_region ?? 'Torres del Paine', owner: r.owner_id === uid }));
  cachePut(uid, 'list', trips);
  return { trips, offline: false };
}

export async function loadTrip(session: Session, id: string): Promise<{ bundle: Bundle; offline: boolean }> {
  const uid = session.user.id;
  const pub = await sb.from('trips').select('id,title,owner_id,data').eq('id', id).maybeSingle();
  if (pub.error || !pub.data) {
    const cached = cacheGet<Bundle>(uid, `trip:${id}`);
    if (cached) return { bundle: cached, offline: true };
    throw pub.error ?? new Error('Trip not found');
  }
  const d = pub.data.data as { trip: Trip; tracks: Tracks };
  let bundle: Bundle = { id, title: pub.data.title, owner: false, trip: d.trip, tracks: d.tracks ?? {} };
  if (pub.data.owner_id === uid) {
    const priv = await sb.from('trip_private').select('data').eq('trip_id', id).maybeSingle();
    const p = priv.data?.data as { trip: Trip; report?: ImportReport; sources?: Bundle['sources'] } | undefined;
    if (p) bundle = { ...bundle, owner: true, trip: p.trip, report: p.report, sources: p.sources };
  }
  cachePut(uid, `trip:${id}`, bundle);
  return { bundle, offline: false };
}

export async function shareTrip(tripId: string, email: string): Promise<string | null> {
  const { error } = await sb.rpc('share_trip', { p_trip: tripId, p_email: email });
  return error ? error.message : null;
}
