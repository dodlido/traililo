// Pictures from the person's own Google Drive. The app can only open the files the person picks in Google's own file picker
// (the "drive.file" permission), never the rest of the Drive. Only the file id is kept in the trip; the picture itself is
// loaded from Google when it is shown. The access lasts about an hour and is kept in memory only.
import { GOOGLE_CLIENT_ID, loadScript, MailError } from './gmail.ts';
import type { DrivePhoto } from './model.ts';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/files';
const GAPI = 'https://apis.google.com/js/api.js';

/** The public key (limited to this site in the Google project), put in at build time. */
export const GOOGLE_API_KEY = typeof __GOOGLE_API_KEY__ === 'string' ? __GOOGLE_API_KEY__ : '';
/** False until the app is built with both the Google client id and the picker key. */
export const driveAvailable = () => GOOGLE_CLIENT_ID !== '' && GOOGLE_API_KEY !== '';
/** The project number is the first part of the client id; the picker wants it as the app id. */
const projectNumber = () => GOOGLE_CLIENT_ID.split('-')[0] ?? '';

interface PickerDoc {
  id: string;
  name?: string;
  mimeType?: string;
}
interface PickerData {
  action: string;
  docs?: PickerDoc[];
}
interface PickerBuilder {
  addView: (v: unknown) => PickerBuilder;
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  enableFeature: (f: unknown) => PickerBuilder;
  setCallback: (cb: (d: PickerData) => void) => PickerBuilder;
  setTitle: (t: string) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}
interface PickerApi {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (id?: unknown) => { setMimeTypes: (m: string) => unknown; setIncludeFolders: (b: boolean) => unknown; setMode: (m: unknown) => unknown };
  ViewId: { DOCS_IMAGES: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Action: { PICKED: string; CANCEL: string };
  DocsViewMode: { GRID: unknown };
}
declare global {
  interface Window {
    gapi?: { load: (name: string, cb: () => void) => void };
  }
}

let token: { value: string; until: number } | null = null;
let picker: Promise<void> | null = null;

/** True while the Google sign-in for Drive is still good. */
export const driveConnected = () => token !== null && token.until > Date.now() + 30_000;

/** Opens Google's permission screen for the picked files. Must be called from a tap. */
export async function connectDrive(): Promise<void> {
  if (!driveAvailable()) throw new MailError('Drive pictures are not set up for this copy of the app.', 'setup');
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

function loadPicker(): Promise<void> {
  picker ??= new Promise<void>((ok, fail) => {
    const done = () => (window.gapi ? window.gapi.load('picker', () => ok()) : fail(new MailError('The Google file picker did not load.', 'network')));
    if (window.gapi) return done();
    const s = document.createElement('script');
    s.src = GAPI;
    s.async = true;
    s.onload = done;
    s.onerror = () => {
      picker = null;
      fail(new MailError('Could not reach Google. Check your connection and try again.', 'network'));
    };
    document.head.appendChild(s);
  });
  return picker;
}

const live = () => {
  if (!token || token.until < Date.now()) {
    token = null;
    throw new MailError('The Google sign-in has run out. Tap again to reconnect.', 'expired');
  }
  return token.value;
};

async function drive(url: string): Promise<Response> {
  const bearer = live();
  let r: Response;
  try {
    r = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  } catch {
    throw new MailError('Could not reach Google Drive. Check your connection and try again.', 'network');
  }
  if (r.status === 401) {
    token = null;
    throw new MailError('The Google sign-in has run out. Tap again to reconnect.', 'expired');
  }
  if (!r.ok) {
    if (r.status === 403 || r.status === 404) throw new MailError('Google would not show that picture. It may have been moved, or the Drive API is not switched on in the Google project.', 'api');
    throw new MailError(`Google Drive refused the request (${r.status}).`, 'api');
  }
  return r;
}

/** Shows Google's picture picker and returns what was chosen (empty if they closed it). */
export async function pickPictures(): Promise<PickerDoc[]> {
  if (!driveConnected()) await connectDrive();
  await loadPicker();
  const g = (window as unknown as { google?: { picker?: PickerApi } }).google?.picker;
  if (!g) throw new MailError('The Google file picker did not load.', 'network');
  return new Promise<PickerDoc[]>((ok) => {
    const view = new g.DocsView(g.ViewId.DOCS_IMAGES);
    view.setMimeTypes('image/jpeg,image/png,image/webp,image/heic,image/heif');
    view.setIncludeFolders(true);
    view.setMode(g.DocsViewMode.GRID);
    new g.PickerBuilder()
      .addView(view)
      .setOAuthToken(live())
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(projectNumber())
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .setTitle('Pick the pictures for this trip')
      .setCallback((d) => {
        if (d.action === g.Action.PICKED) ok(d.docs ?? []);
        else if (d.action === g.Action.CANCEL) ok([]);
      })
      .build()
      .setVisible(true);
  });
}

interface Meta {
  id: string;
  name?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { time?: string; location?: { latitude?: number; longitude?: number } };
}
const FIELDS = 'id,name,thumbnailLink,imageMediaMetadata(time,location(latitude,longitude))';
const metas = new Map<string, Promise<Meta>>();

function meta(id: string): Promise<Meta> {
  let m = metas.get(id);
  if (!m) {
    m = drive(`${API}/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`).then((r) => r.json() as Promise<Meta>);
    m.catch(() => metas.delete(id));
    metas.set(id, m);
  }
  return m;
}

/** "2027:03:16 14:22:10" (the camera's own clock) as "2027-03-16T14:22:10". */
export function takenOf(time?: string): string | undefined {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(time ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : undefined;
}

/** What the app keeps about each picked picture: the id, the name, and when and where it was taken if the camera said. */
export async function describe(docs: PickerDoc[]): Promise<DrivePhoto[]> {
  const out: DrivePhoto[] = [];
  for (const d of docs) {
    let photo: DrivePhoto = { id: d.id, name: d.name ?? 'Picture' };
    try {
      const m = await meta(d.id);
      const loc = m.imageMediaMetadata?.location;
      photo = {
        id: d.id,
        name: m.name ?? photo.name,
        ...(takenOf(m.imageMediaMetadata?.time) ? { taken: takenOf(m.imageMediaMetadata?.time) } : {}),
        ...(loc?.latitude !== undefined && loc.longitude !== undefined ? { lat: loc.latitude, lon: loc.longitude } : {}),
      };
    } catch {
      /* keep it with just the name; it goes on the day it was added to */
    }
    out.push(photo);
  }
  return out;
}

const blobs = new Map<string, Promise<string>>();

/** A web address the picture can be shown from, at about `size` pixels wide. Needs the Drive sign-in. */
export async function pictureSrc(id: string, size = 600): Promise<string> {
  const m = await meta(id);
  if (m.thumbnailLink) return m.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
  return pictureBlob(id);
}

/** Fallback: downloads the picture itself with the sign-in and shows it from memory. */
export function pictureBlob(id: string): Promise<string> {
  let b = blobs.get(id);
  if (!b) {
    b = drive(`${API}/${encodeURIComponent(id)}?alt=media`)
      .then((r) => r.blob())
      .then((blob) => URL.createObjectURL(blob));
    b.catch(() => blobs.delete(id));
    blobs.set(id, b);
  }
  return b;
}

/** Where the picture opens in Drive. */
export const driveLink = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;

/** Puts picked pictures on the right days: the day they were taken if that is in the trip, otherwise the day they were added from. */
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
