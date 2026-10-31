// Pictures for the trip, kept in the owner's own Google Drive.
// The owner picks pictures in Google Photos' own popup (the Photos Picker). Google hands over links that stop working after
// an hour, so each chosen picture is copied at once, at 1600 px, into a folder this app creates in the owner's Drive.
// Files an app creates itself stay readable by it ("drive.file"), so the app can show them later without being able to see
// anything else in the Drive. Only the Drive file id is kept in the trip. Access lasts about an hour and is kept in memory only.
import { GOOGLE_CLIENT_ID, loadScript, MailError } from './gmail.ts';
import type { DrivePhoto } from './model.ts';

const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const PICKER = 'https://photospicker.googleapis.com/v1';

/** False until the app is built with the Google client id. */
export const driveAvailable = () => GOOGLE_CLIENT_ID !== '';

let token: { value: string; until: number } | null = null;

/** True while the Google sign-in is still good. */
export const driveConnected = () => token !== null && token.until > Date.now() + 30_000;

/** Opens Google's permission screen. Must be called from a tap. */
export async function connectDrive(): Promise<void> {
  if (!driveAvailable()) throw new MailError('Pictures are not set up for this copy of the app.', 'setup');
  await loadScript();
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new MailError('Google sign-in did not load.', 'network');
  token = await new Promise<{ value: string; until: number }>((ok, fail) => {
    const client = oauth.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) {
          fail(
            r.error === 'access_denied'
              ? new MailError('Google did not give access. If you saw “Error 403: access_denied”, ask the trip owner to add your email as a test user.', 'denied')
              : new MailError(`Google sign-in failed${r.error ? ` (${r.error})` : ''}.`, 'api'),
          );
          return;
        }
        ok({ value: r.access_token, until: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
      },
      error_callback: (e) =>
        fail(
          e.type === 'popup_failed_to_open'
            ? new MailError('The sign-in window was blocked. Allow popups for this site and tap again.', 'popup')
            : new MailError('The sign-in was closed before it finished.', 'denied'),
        ),
    });
    client.requestAccessToken();
  });
}

const live = () => {
  if (!token || token.until < Date.now()) {
    token = null;
    throw new MailError('The Google sign-in has run out. Tap again to reconnect.', 'expired');
  }
  return token.value;
};

async function call(url: string, init: RequestInit = {}, what = 'Google'): Promise<Response> {
  const bearer = live();
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${bearer}` } });
  } catch {
    throw new MailError(`Could not reach ${what}. Check your connection and try again.`, 'network');
  }
  if (r.status === 401) {
    token = null;
    throw new MailError('The Google sign-in has run out. Tap again to reconnect.', 'expired');
  }
  if (!r.ok) {
    let reason = '';
    try {
      const j = (await r.clone().json()) as { error?: { message?: string; status?: string } };
      reason = j.error?.status ?? j.error?.message ?? '';
    } catch {
      /* no detail */
    }
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(reason)) throw new MailError(`${what} is not switched on in the Google project (the Drive API and the Google Photos Picker API both need enabling).`, 'setup');
    if (r.status === 403) throw new MailError(`${what} did not allow that. Disconnect and connect again, and tick every permission box.`, 'denied');
    if (r.status === 429) throw new MailError(`${what} is busy. Wait a minute and try again.`, 'api');
    throw new MailError(`${what} refused the request (${r.status}${reason ? `, ${reason}` : ''}).`, 'api');
  }
  return r;
}

// ---------------------------------------------------------------- choosing in Google Photos

interface Session {
  id: string;
  pickerUri?: string;
  mediaItemsSet?: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}
interface Picked {
  id: string;
  createTime?: string;
  type?: string;
  mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string };
  baseUrl?: string;
  mimeType?: string;
}
export interface PickedPicture {
  id: string;
  name: string;
  /** When it was taken, as an instant. */
  created?: string;
  baseUrl: string;
  mime: string;
}

const seconds = (d: string | undefined, fallback: number) => {
  const n = parseFloat(d ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Opens Google Photos in a popup and waits until the person has chosen. `popup` is a window opened in the same tap as the
 * button press (browsers only allow that then); it is pointed at Google Photos once the session exists.
 */
export async function chooseInPhotos(popup: Window | null, onLink: (url: string) => void): Promise<PickedPicture[]> {
  const s = (await (await call(`${PICKER}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 'Google Photos')).json()) as Session;
  if (!s.id || !s.pickerUri) throw new MailError('Google Photos did not start a picking session.', 'api');
  const url = `${s.pickerUri}/autoclose`;
  if (popup && !popup.closed) popup.location.href = url;
  else onLink(url);
  const every = seconds(s.pollingConfig?.pollInterval, 3) * 1000;
  const until = Date.now() + seconds(s.pollingConfig?.timeoutIn, 600) * 1000;
  let done = false;
  while (Date.now() < until) {
    await sleep(Math.max(1500, Math.min(every, 5000)));
    const st = (await (await call(`${PICKER}/sessions/${encodeURIComponent(s.id)}`, {}, 'Google Photos')).json()) as Session;
    if (st.mediaItemsSet) {
      done = true;
      break;
    }
  }
  try {
    popup?.close();
  } catch {
    /* already closed */
  }
  if (!done) {
    void call(`${PICKER}/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }, 'Google Photos').catch(() => {});
    return [];
  }
  const out: PickedPicture[] = [];
  let page = '';
  do {
    const q = `sessionId=${encodeURIComponent(s.id)}&pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const j = (await (await call(`${PICKER}/mediaItems?${q}`, {}, 'Google Photos')).json()) as { mediaItems?: Picked[]; nextPageToken?: string };
    for (const m of j.mediaItems ?? []) {
      const baseUrl = m.mediaFile?.baseUrl ?? m.baseUrl;
      const mime = m.mediaFile?.mimeType ?? m.mimeType ?? '';
      if (!baseUrl || (m.type && m.type !== 'PHOTO' && m.type !== 'TYPE_UNSPECIFIED') || !mime.startsWith('image/')) continue;
      out.push({ id: m.id, name: m.mediaFile?.filename ?? `${m.id}.jpg`, created: m.createTime, baseUrl, mime });
    }
    page = j.nextPageToken ?? '';
  } while (page);
  void call(`${PICKER}/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }, 'Google Photos').catch(() => {});
  return out;
}

// ---------------------------------------------------------------- the trip's folder in Drive

const folders = new Map<string, Promise<string>>();

/** The folder for this trip, made on first use. Only folders this app made can be found, which is what we want. */
export function tripFolder(title: string): Promise<string> {
  const name = `TraiLilo · ${title}`;
  let f = folders.get(name);
  if (!f) {
    f = (async () => {
      const q = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed=false`;
      const found = (await (await call(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {}, 'Google Drive')).json()) as { files?: { id: string }[] };
      if (found.files?.[0]) return found.files[0].id;
      const made = (await (await call(`${DRIVE}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }) }, 'Google Drive')).json()) as { id: string };
      return made.id;
    })();
    f.catch(() => folders.delete(name));
    folders.set(name, f);
  }
  return f;
}

/**
 * The local date and time a picture was taken, "2027-03-16T14:22:10". Google gives an instant, not a place, so the clock is
 * estimated from the longitude of where the day is (15 degrees per hour); it can be an hour or two off but not a day.
 */
export function localTaken(created: string | undefined, lon: number | undefined): string | undefined {
  const t = created ? Date.parse(created) : NaN;
  if (!Number.isFinite(t)) return undefined;
  const offset = typeof lon === 'number' ? Math.round(lon / 15) : 0;
  return new Date(t + offset * 3600_000).toISOString().slice(0, 19);
}

/** The file name a picture gets in Drive: when it was taken, then its own name. The same picture always gets the same name. */
export const driveName = (pic: { name: string }, taken: string | undefined) => `${taken ? `${taken.replace('T', '_').replace(/:/g, '-')} ` : ''}${pic.name}`.replace(/[\\/]/g, '-');

/** Copies one chosen picture into the trip's folder and returns what the trip keeps about it. */
export async function saveToDrive(pic: PickedPicture, folder: string, taken: string | undefined): Promise<DrivePhoto> {
  const bytes = await call(`${pic.baseUrl}=w1600-h1600`, {}, 'Google Photos').then((r) => r.blob());
  const name = driveName(pic, taken);
  const meta = { name, parents: [folder], mimeType: pic.mime, appProperties: taken ? { taken } : undefined };
  const edge = `tl${Math.random().toString(36).slice(2)}`;
  const body = new Blob([`--${edge}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${edge}\r\nContent-Type: ${pic.mime}\r\n\r\n`, bytes, `\r\n--${edge}--`]);
  const made = (await (await call(`${UPLOAD}?uploadType=multipart&fields=id,name`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${edge}` }, body }, 'Google Drive')).json()) as { id: string; name?: string };
  return { id: made.id, name: made.name ?? name, ...(taken ? { taken } : {}) };
}

// ---------------------------------------------------------------- showing them

const thumbs = new Map<string, Promise<string>>();
const known = new Map<string, string>();

/** The address of a picture that has been looked up already, so it can be shown on the very first draw. */
export function peekPicture(id: string, size = 600): string | undefined {
  const u = known.get(id);
  return u ? u.replace(/=s\d+$/, `=s${size}`) : undefined;
}
const blobs = new Map<string, Promise<string>>();

/** A web address the picture can be shown from, at about `size` pixels wide. Needs the sign-in. */
export function pictureSrc(id: string, size = 600): Promise<string> {
  let t = thumbs.get(id);
  if (!t) {
    t = call(`${DRIVE}/${encodeURIComponent(id)}?fields=thumbnailLink`, {}, 'Google Drive')
      .then((r) => r.json() as Promise<{ thumbnailLink?: string }>)
      .then((m) => m.thumbnailLink ?? pictureBlob(id))
      .then((u) => (known.set(id, u), u));
    t.catch(() => thumbs.delete(id));
    thumbs.set(id, t);
  }
  // the size is applied on the way out, so a small tile and a big cover can share the one lookup
  return t.then((u) => u.replace(/=s\d+$/, `=s${size}`));
}

/** Downloads the picture itself with the sign-in and shows it from memory. */
export function pictureBlob(id: string): Promise<string> {
  let b = blobs.get(id);
  if (!b) {
    b = call(`${DRIVE}/${encodeURIComponent(id)}?alt=media`, {}, 'Google Drive')
      .then((r) => r.blob())
      .then((blob) => URL.createObjectURL(blob));
    b.catch(() => blobs.delete(id));
    blobs.set(id, b);
  }
  return b;
}

/** Where the picture opens in Drive. */
export const driveLink = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;

/** Puts saved pictures on the right days: the day they were taken if that is in the trip, otherwise the day they were added from. */
export function placeOnDays(days: { date: string; drivePhotos?: DrivePhoto[] }[], photos: DrivePhoto[], fallback: string): { placed: number; skipped: number; elsewhere: number } {
  let placed = 0;
  let skipped = 0;
  let elsewhere = 0;
  const have = new Set(days.flatMap((d) => d.drivePhotos?.map((p) => p.id) ?? []));
  for (const p of photos) {
    if (have.has(p.id)) {
      skipped++;
      continue;
    }
    const date = p.taken?.slice(0, 10);
    const day = days.find((d) => d.date === date) ?? days.find((d) => d.date === fallback);
    if (!day) continue;
    if (day.date !== fallback) elsewhere++;
    (day.drivePhotos ??= []).push(p);
    day.drivePhotos.sort((a, b) => (a.taken ?? '').localeCompare(b.taken ?? '') || a.name.localeCompare(b.name));
    have.add(p.id);
    placed++;
  }
  return { placed, skipped, elsewhere };
}

/** Forgets the sign-in and tells Google to cancel it. */
export async function disconnectDrive(): Promise<void> {
  const t = token?.value;
  token = null;
  if (t && window.google?.accounts?.oauth2) await new Promise<void>((done) => window.google!.accounts.oauth2.revoke(t, () => done()));
}
