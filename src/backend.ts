// Everything that talks to the database. Trips live in Supabase; row-level rules decide who can read what:
//  - trips: the title, dates and map tracks of a trip, readable by its members (after 2FA)
//  - trip_private: the full version with bookings and to-dos, readable by the owner only (after 2FA)
import { createClient, type Session } from '@supabase/supabase-js';
import type { ImportReport, StayType, Trip } from './model.ts';
import type { Tracks } from './model.ts';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.ts';
import { SCHEMA, migrate } from './migrate.ts';

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
  role: 'owner' | 'partner';
}
export interface Bundle {
  id: string;
  version: number;
  cover: string;
  title: string;
  /** True for the owner and for travel partners: they see and edit the full version. */
  owner: boolean;
  role?: 'owner' | 'partner';
  trip: Trip;
  tracks: Tracks;
  report?: ImportReport;
  sources?: Record<string, Record<string, string>>;
  /** Changes made on this phone that never reached the database (no signal at the time). */
  pending?: Pending;
}
/** An unsent change: the whole trip as it is on this phone, and the saved version it was built on. */
export interface Pending {
  base: number;
  trip: Trip;
  tracks: Tracks;
  title: string;
  cover: string;
  at: string;
}

/** How long to wait for the database before falling back to what this phone has. */
export const WAIT_MS = 8000;
/** Gives up on a request that gets no answer (a weak signal can leave one hanging for minutes). */
export function withTimeout<T>(p: PromiseLike<T>, ms = WAIT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The connection is too slow.')), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
/** True for "no connection / too slow" (worth keeping the change and trying again), false for an answer from the server. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : (e as { message?: string } | null)?.message ?? '';
  return /failed to fetch|networkerror|network request failed|load failed|too slow|timed out|timeout|aborted/i.test(msg);
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
const pendingKey = (tripId: string) => `traililo:pending:${tripId}`;
export function pendingGet(tripId: string): Pending | null {
  try {
    const raw = localStorage.getItem(pendingKey(tripId));
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    return p && p.trip && typeof p.base === 'number' ? { ...p, trip: migrate(p.trip) } : null;
  } catch {
    return null;
  }
}
/** Returns false when the phone had no room to keep it. */
export function pendingPut(tripId: string, p: Pending): boolean {
  try {
    localStorage.setItem(pendingKey(tripId), JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
export function pendingClear(tripId: string) {
  try {
    localStorage.removeItem(pendingKey(tripId));
  } catch {
    /* ignore */
  }
}
/** True when any trip on this phone has changes that were not uploaded yet. */
export function anyPending(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('traililo:pending:'));
  } catch {
    return false;
  }
}

/** Forget the trips kept on this device (used when signing out). Changes not uploaded yet can be kept, so a session that
 *  ended by itself does not throw away a journal entry. */
export function clearCache(keepUnsent = false) {
  try {
    for (const k of Object.keys(localStorage)) if ((k.startsWith('traililo:') || k.startsWith('tl.')) && !(keepUnsent && k.startsWith('traililo:pending:'))) localStorage.removeItem(k);
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  // pictures kept for offline viewing
  try {
    void caches?.keys().then((ks) => ks.filter((k) => k.startsWith('traililo-photos')).forEach((k) => void caches.delete(k)));
  } catch {
    /* no cache storage here */
  }
}
/** True when the server answered that this account may not see the trip (as opposed to there being no connection). */
const refused = (e: unknown) => !isNetworkError(e) && !/jwt|expired/i.test((e as Error)?.message ?? '') && (e as { code?: string })?.code !== 'PGRST301';

export async function listTrips(session: Session): Promise<{ trips: TripSummary[]; offline: boolean }> {
  const uid = session.user.id;
  const got = await withTimeout(sb.from('trips').select('id,title,start_date,end_date,cover_region,owner_id').order('start_date', { ascending: false })).catch((e: unknown) => ({ data: null, error: e as Error }));
  const { data, error } = got;
  if (error) {
    const cached = refused(error) ? null : cacheGet<TripSummary[]>(uid, 'list');
    if (cached) return { trips: cached, offline: true };
    throw error;
  }
  const mine = await withTimeout(sb.from('trip_members').select('trip_id,role').eq('user_id', uid)).catch(() => ({ data: null }));
  const roles = new Map<string, string>((mine.data ?? []).map((m) => [m.trip_id as string, m.role as string]));
  // a trip is yours (owner) or shared with you as a travel partner; there is no read-only view
  const trips: TripSummary[] = (data ?? []).filter((r) => r.owner_id === uid || roles.get(r.id) === 'partner').map((r) => ({
    id: r.id,
    title: r.title,
    start_date: r.start_date,
    end_date: r.end_date,
    cover_region: r.cover_region ?? 'Torres del Paine',
    owner: r.owner_id === uid,
    role: r.owner_id === uid ? 'owner' : 'partner',
  }));
  cachePut(uid, 'list', trips);
  // a trip you can no longer open (access removed) is also forgotten on this phone
  const ids = new Set(trips.map((t) => t.id));
  try {
    for (const k of Object.keys(localStorage)) {
      const m = k.startsWith(cacheKey(uid, 'trip:')) ? k.slice(cacheKey(uid, 'trip:').length) : '';
      if (m && !ids.has(m) && !pendingGet(m)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  return { trips, offline: false };
}

/** What this phone remembers of a trip (the last copy it saw, with any unsent change laid over it). */
function fromPhone(uid: string, id: string): Bundle | null {
  const cached = cacheGet<Bundle>(uid, `trip:${id}`);
  if (!cached) return null;
  return { ...cached, trip: migrate(cached.trip), pending: pendingGet(id) ?? undefined };
}

export async function loadTrip(session: Session, id: string): Promise<{ bundle: Bundle; offline: boolean }> {
  const uid = session.user.id;
  try {
    const pub = await withTimeout(sb.from('trips').select('id,title,owner_id,data,version,cover_region').eq('id', id).maybeSingle());
    if (pub.error || !pub.data) throw pub.error ?? new Error('Trip not found');
    const d = pub.data.data as { tracks?: Tracks };
    let role: 'owner' | 'partner' | null = null;
    if (pub.data.owner_id === uid) role = 'owner';
    else {
      const m = await withTimeout(sb.from('trip_members').select('role').eq('trip_id', id).eq('user_id', uid).maybeSingle());
      if (m.data?.role === 'partner') role = 'partner';
    }
    if (!role) throw new Error('This trip is not shared with you.');
    const priv = await withTimeout(sb.from('trip_private').select('data').eq('trip_id', id).maybeSingle());
    const p = priv.data?.data as { trip: Trip; report?: ImportReport; sources?: Bundle['sources'] } | undefined;
    if (!p) throw priv.error ?? new Error('Trip not found');
    const bundle: Bundle = { id, version: pub.data.version ?? 1, cover: pub.data.cover_region ?? 'Torres del Paine', title: pub.data.title, owner: true, role, trip: migrate(p.trip), tracks: d.tracks ?? {}, report: p.report, sources: p.sources };
    cachePut(uid, `trip:${id}`, bundle);
    return { bundle: { ...bundle, pending: pendingGet(id) ?? undefined }, offline: false };
  } catch (e) {
    // no answer, or too slow: open the copy kept on this phone instead
    if (refused(e)) {
      // access was removed (or the trip is gone): do not keep serving the copy from this phone
      try {
        localStorage.removeItem(cacheKey(uid, `trip:${id}`));
      } catch {
        /* ignore */
      }
      throw e;
    }
    const kept = fromPhone(uid, id);
    if (kept) return { bundle: kept, offline: true };
    throw e;
  }
}

export async function shareTrip(tripId: string, email: string): Promise<string | null> {
  const { error } = await sb.rpc('share_trip', { p_trip: tripId, p_email: email, p_role: 'partner' });
  return error ? error.message : null;
}
export async function unshareTrip(tripId: string, email: string): Promise<string | null> {
  const { error } = await sb.rpc('unshare_trip', { p_trip: tripId, p_email: email });
  return error ? error.message : null;
}
export async function listMembers(tripId: string): Promise<{ email: string; role: 'partner' }[]> {
  const { data, error } = await sb.rpc('list_members', { p_trip: tripId });
  if (error) throw new Error(error.message);
  return (data ?? []) as { email: string; role: 'partner' }[];
}

/** The newest saved copy of a trip, for when someone else saved first. */
export async function fetchLatest(id: string): Promise<{ version: number; trip: Trip; tracks: Tracks }> {
  const pub = await withTimeout(sb.from('trips').select('data,version').eq('id', id).single());
  if (pub.error) throw new Error(pub.error.message);
  const priv = await withTimeout(sb.from('trip_private').select('data').eq('trip_id', id).single());
  if (priv.error) throw new Error(priv.error.message);
  const d = pub.data.data as { trip: Trip; tracks: Tracks };
  return { version: pub.data.version ?? 1, trip: migrate((priv.data.data as { trip: Trip }).trip), tracks: d.tracks ?? {} };
}

import { computeTotals } from './totals.ts';

/** Save the owner's version of a trip. Returns the new version number. Throws with a readable message on failure
 *  (a connection problem is recognised with isNetworkError). A good save also refreshes the copy kept on this phone. */
export async function saveTrip(b: Bundle, trip: Trip): Promise<number> {
  const full = { ...trip, totals: computeTotals(trip), schemaVersion: SCHEMA };
  const { data, error } = await withTimeout(
    sb.rpc('save_trip', {
      p_trip: b.id,
      p_version: b.version,
      p_title: b.title,
      p_cover: b.cover,
      p_start: full.startDate,
      p_end: full.endDate,
      p_public: { tracks: b.tracks },
      p_private: { trip: full, report: b.report, sources: b.sources },
    }),
    20000,
  );
  if (error) throw new Error(error.message);
  const version = data as number;
  try {
    const uid = (await sb.auth.getSession()).data.session?.user.id;
    if (uid) cachePut(uid, `trip:${b.id}`, { ...b, version, trip: full, pending: undefined });
  } catch {
    /* the save itself worked */
  }
  return version;
}

/** Deletes a trip for good (owner only), with its stored pictures and the copy kept on this device. Throws with a readable message on failure. */
export async function deleteTrip(session: Session, id: string): Promise<void> {
  const uid = session.user.id;
  const { error } = await sb.rpc('delete_trip', { p_trip: id });
  if (error) throw new Error(error.message);
  try {
    const dir = `${uid}/${id}`;
    const { data } = await sb.storage.from('photos').list(dir, { limit: 1000 });
    if (data?.length) await sb.storage.from('photos').remove(data.map((f) => `${dir}/${f.name}`));
  } catch {
    /* the trip is gone; leftover pictures are harmless */
  }
  try {
    localStorage.removeItem(cacheKey(uid, `trip:${id}`));
    const list = cacheGet<TripSummary[]>(uid, 'list');
    if (list) cachePut(uid, 'list', list.filter((t) => t.id !== id));
  } catch {
    /* ignore */
  }
}

export async function createTrip(title: string, cover: string, trip: Trip): Promise<string> {
  const full = { ...trip, totals: computeTotals(trip) };
  const { data, error } = await sb.rpc('create_trip', {
    p_title: title,
    p_cover: cover,
    p_start: full.startDate,
    p_end: full.endDate,
    p_public: { tracks: {} },
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
