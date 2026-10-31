// Everything that talks to the database. Trips live in Supabase; row-level rules decide who can read what:
//  - trips: the friends' version of a trip, readable by its members (after 2FA)
//  - trip_private: the full version with bookings and to-dos, readable by the owner only (after 2FA)
import { createClient, type Session } from '@supabase/supabase-js';
import type { ImportReport, StayType, Trip } from './model.ts';
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
  /** How this trip came to you. */
  role: 'owner' | 'partner' | 'friend';
}
export interface Bundle {
  id: string;
  version: number;
  cover: string;
  title: string;
  /** True for the owner and for travel partners: they see and edit the full version. */
  owner: boolean;
  role?: 'owner' | 'partner' | 'friend';
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
  const mine = await sb.from('trip_members').select('trip_id,role').eq('user_id', uid);
  const roles = new Map<string, string>((mine.data ?? []).map((m) => [m.trip_id as string, m.role as string]));
  const trips: TripSummary[] = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    start_date: r.start_date,
    end_date: r.end_date,
    cover_region: r.cover_region ?? 'Torres del Paine',
    owner: r.owner_id === uid,
    role: r.owner_id === uid ? 'owner' : roles.get(r.id) === 'partner' ? 'partner' : 'friend',
  }));
  cachePut(uid, 'list', trips);
  return { trips, offline: false };
}

/** Trips saved before lodges and refugios were folded into hotels and camps. */
function legacyTypes(t: Trip): Trip {
  const old: Record<string, StayType> = { lodge: 'hotel', refugio: 'camp' };
  if (!t.stays.some((s) => (s.type as string) in old)) return t;
  return { ...t, stays: t.stays.map((s) => ((s.type as string) in old ? { ...s, type: old[s.type as string] } : s)) };
}

export async function loadTrip(session: Session, id: string): Promise<{ bundle: Bundle; offline: boolean }> {
  const uid = session.user.id;
  const pub = await sb.from('trips').select('id,title,owner_id,data,version,cover_region').eq('id', id).maybeSingle();
  if (pub.error || !pub.data) {
    const cached = cacheGet<Bundle>(uid, `trip:${id}`);
    if (cached) return { bundle: { ...cached, trip: legacyTypes(cached.trip) }, offline: true };
    throw pub.error ?? new Error('Trip not found');
  }
  const d = pub.data.data as { trip: Trip; tracks: Tracks };
  let role: 'owner' | 'partner' | 'friend' = 'friend';
  if (pub.data.owner_id === uid) role = 'owner';
  else {
    const m = await sb.from('trip_members').select('role').eq('trip_id', id).eq('user_id', uid).maybeSingle();
    if (m.data?.role === 'partner') role = 'partner';
  }
  let bundle: Bundle = { id, version: pub.data.version ?? 1, cover: pub.data.cover_region ?? 'Torres del Paine', title: pub.data.title, owner: false, role, trip: legacyTypes(d.trip), tracks: d.tracks ?? {} };
  if (role !== 'friend') {
    const priv = await sb.from('trip_private').select('data').eq('trip_id', id).maybeSingle();
    const p = priv.data?.data as { trip: Trip; report?: ImportReport; sources?: Bundle['sources'] } | undefined;
    if (p) bundle = { ...bundle, owner: true, trip: legacyTypes(p.trip), report: p.report, sources: p.sources };
  }
  cachePut(uid, `trip:${id}`, bundle);
  return { bundle, offline: false };
}

export async function shareTrip(tripId: string, email: string, role: 'friend' | 'partner' = 'friend'): Promise<string | null> {
  const { error } = await sb.rpc('share_trip', { p_trip: tripId, p_email: email, p_role: role });
  return error ? error.message : null;
}
export async function unshareTrip(tripId: string, email: string): Promise<string | null> {
  const { error } = await sb.rpc('unshare_trip', { p_trip: tripId, p_email: email });
  return error ? error.message : null;
}
export async function listMembers(tripId: string): Promise<{ email: string; role: 'friend' | 'partner' }[]> {
  const { data, error } = await sb.rpc('list_members', { p_trip: tripId });
  if (error) throw new Error(error.message);
  return (data ?? []) as { email: string; role: 'friend' | 'partner' }[];
}

/** The newest saved copy of a trip, for when someone else saved first. */
export async function fetchLatest(id: string): Promise<{ version: number; trip: Trip; tracks: Tracks }> {
  const pub = await sb.from('trips').select('data,version').eq('id', id).single();
  if (pub.error) throw new Error(pub.error.message);
  const priv = await sb.from('trip_private').select('data').eq('trip_id', id).single();
  if (priv.error) throw new Error(priv.error.message);
  const d = pub.data.data as { trip: Trip; tracks: Tracks };
  return { version: pub.data.version ?? 1, trip: (priv.data.data as { trip: Trip }).trip, tracks: d.tracks ?? {} };
}

import { publicVersion } from './privacy.ts';
import { computeTotals } from './totals.ts';

/** Save the owner's version of a trip. Returns the new version number. Throws with a readable message on failure. */
export async function saveTrip(b: Bundle, trip: Trip): Promise<number> {
  const full = { ...trip, totals: computeTotals(trip) };
  const { data, error } = await sb.rpc('save_trip', {
    p_trip: b.id,
    p_version: b.version,
    p_title: b.title,
    p_cover: b.cover,
    p_start: full.startDate,
    p_end: full.endDate,
    p_public: { trip: publicVersion(full), tracks: b.tracks },
    p_private: { trip: full, report: b.report, sources: b.sources },
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function createTrip(title: string, cover: string, trip: Trip): Promise<string> {
  const full = { ...trip, totals: computeTotals(trip) };
  const { data, error } = await sb.rpc('create_trip', {
    p_title: title,
    p_cover: cover,
    p_start: full.startDate,
    p_end: full.endDate,
    p_public: { trip: publicVersion(full), tracks: {} },
    p_private: { trip: full },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Set when a trip has just been created, so it opens ready for editing. */
export const fresh = { id: '' };

// ---------- photos you upload ----------
/** Where an uploaded photo can be read from. */
export const photoUrlOf = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/photos/${path}`;

export async function uploadPhoto(blob: Blob, tripId: string): Promise<string> {
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Sign in again to upload');
  const path = `${uid}/${tripId}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw new Error(/not found|bucket/i.test(error.message) ? 'Photo storage is not set up yet (run migration-3.sql)' : error.message);
  return path;
}

export async function deletePhoto(path: string): Promise<void> {
  await sb.storage.from('photos').remove([path]).catch(() => {});
}
