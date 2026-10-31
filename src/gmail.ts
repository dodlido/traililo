// Reads booking emails from the person's own Gmail, on their own device.
// Google's sign-in script is loaded only when someone taps Connect. The access it gives lasts about an hour and is kept in
// memory only: never saved, never sent anywhere but Google. The search is fixed in this file, so the app asks Gmail only for
// mail from the booking sites and nothing else.

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GIS = 'https://accounts.google.com/gsi/client';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** The public id of the Google project, put in at build time. Empty when this copy of the app is not set up for Gmail. */
export const GOOGLE_CLIENT_ID = typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : '';
export const gmailAvailable = () => GOOGLE_CLIENT_ID !== '';

/** How far back to look. */
export const MONTHS_BACK = 18;

/** Who the app looks for mail from. Shown to the person before they connect. */
export const SENDERS = ['booking.com', 'airbnb.com', 'getyourguide.com'];

export interface MailMessage {
  id: string;
  /** Milliseconds since 1970, when Gmail received it. */
  date: number;
  from: string;
  subject: string;
  /** The readable text of the email. */
  text: string;
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly kind: 'denied' | 'popup' | 'expired' | 'api' | 'network' | 'setup' = 'api',
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- the search

const pad = (n: number) => String(n).padStart(2, '0');
/** The Gmail search: the booking sites, and activity operators that quote a GetYourGuide booking reference, since a date. */
export function searchFor(now: Date = new Date()): string {
  const from = new Date(now);
  from.setMonth(from.getMonth() - MONTHS_BACK);
  const after = `${from.getFullYear()}/${pad(from.getMonth() + 1)}/${pad(from.getDate())}`;
  return `after:${after} (${SENDERS.map((s) => `from:${s}`).join(' OR ')} OR ("booking reference" GYG))`;
}

// ---------------------------------------------------------------- signing in

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void;
}
interface GoogleOauth {
  initTokenClient: (c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback: (e: { type?: string }) => void }) => TokenClient;
  revoke: (token: string, done: () => void) => void;
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOauth } };
  }
}

let token: { value: string; until: number } | null = null;
let script: Promise<void> | null = null;

export function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  script ??= new Promise<void>((ok, fail) => {
    const s = document.createElement('script');
    s.src = GIS;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      script = null;
      fail(new MailError('Could not reach Google. Check your connection and try again.', 'network'));
    };
    document.head.appendChild(s);
  });
  return script;
}

/** True while the sign-in is still good. */
export const connected = () => token !== null && token.until > Date.now() + 30_000;

/** Opens Google's sign-in and permission screen. Must be called from a tap, or the browser blocks the popup. */
export async function connect(): Promise<void> {
  if (!gmailAvailable()) throw new MailError('Gmail is not set up for this copy of the app.', 'setup');
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
            ? new MailError('The sign-in window was blocked. Allow popups for this site and tap Connect again.', 'popup')
            : new MailError('The sign-in was closed before it finished. If you saw “Error 403: access_denied”, ask the trip owner to add your email as a test user.', 'denied'),
        ),
    });
    client.requestAccessToken();
  });
}

/** Signs out: tells Google to cancel this access, and forgets it. */
export async function disconnect(): Promise<void> {
  const t = token?.value;
  token = null;
  if (t && window.google?.accounts?.oauth2) await new Promise<void>((done) => window.google!.accounts.oauth2.revoke(t, () => done()));
}

// ---------------------------------------------------------------- talking to Gmail

async function api<T>(path: string): Promise<T> {
  if (!token || token.until < Date.now()) {
    token = null;
    throw new MailError('The Gmail sign-in has run out. Tap Connect again.', 'expired');
  }
  let r: Response;
  try {
    r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token.value}` } });
  } catch {
    throw new MailError('Could not reach Gmail. Check your connection and try again.', 'network');
  }
  if (r.status === 401) {
    token = null;
    throw new MailError('The Gmail sign-in has run out. Tap Connect again.', 'expired');
  }
  if (!r.ok) {
    let reason = '';
    try {
      const j = (await r.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
      reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? '';
    } catch {
      /* no detail */
    }
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) throw new MailError('The Gmail API is not switched on in the Google project (step 2 of the setup).', 'setup');
    if (/insufficient|PERMISSION_DENIED/i.test(reason)) throw new MailError('The permission to read mail was not ticked. Disconnect, then connect again and tick it.', 'denied');
    if (r.status === 429) throw new MailError('Gmail is busy. Wait a minute and try again.', 'api');
    throw new MailError(`Gmail refused the request (${r.status}${reason ? `, ${reason}` : ''}).`, 'api');
  }
  return (await r.json()) as T;
}

interface Part {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: Part[];
}
interface Raw {
  id: string;
  internalDate?: string;
  payload?: Part;
}

/** The ids of matching messages, newest first. At most `max`. */
export async function listIds(q: string, max = 300): Promise<string[]> {
  const ids: string[] = [];
  let page = '';
  while (ids.length < max) {
    const j = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?q=${encodeURIComponent(q)}&maxResults=100${page}`);
    ids.push(...(j.messages ?? []).map((m) => m.id));
    if (!j.nextPageToken) break;
    page = `&pageToken=${encodeURIComponent(j.nextPageToken)}`;
  }
  return ids.slice(0, max);
}

const decoder = (charset: string) => {
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder('utf-8');
  }
};
/** Gmail sends the content of each part as web-safe base64. */
function decodeBody(data: string, contentType: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const cs = /charset="?([\w-]+)"?/i.exec(contentType)?.[1] ?? 'utf-8';
  return decoder(cs).decode(bytes);
}

const header = (p: Part | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';

function collect(p: Part, out: { plain: string[]; html: string[] }) {
  const type = (p.mimeType ?? '').toLowerCase();
  if (p.body?.data && (type === 'text/plain' || type === 'text/html')) {
    const t = decodeBody(p.body.data, header(p, 'content-type') || type);
    (type === 'text/plain' ? out.plain : out.html).push(t);
  }
  for (const c of p.parts ?? []) collect(c, out);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', euro: '€' };
/** The text of an HTML email, with one line per block. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6]|table)>|<\/t[dh]>/gi, (m) => (/t[dh]/i.test(m) ? ' \n' : '\n'))
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A Gmail message as readable text: the plain part when there is a real one, otherwise the HTML turned into text. */
export function readMessage(m: Raw): MailMessage {
  const parts = { plain: [] as string[], html: [] as string[] };
  if (m.payload) collect(m.payload, parts);
  const plain = parts.plain.join('\n').trim();
  const text = plain.length >= 200 || !parts.html.length ? plain : htmlToText(parts.html.join('\n'));
  return { id: m.id, date: Number(m.internalDate) || 0, from: header(m.payload, 'from'), subject: header(m.payload, 'subject'), text };
}

export async function getMessage(id: string): Promise<MailMessage> {
  return readMessage(await api<Raw>(`/messages/${id}?format=full`));
}

/** Reads many messages, a few at a time. `step` is called after each one. */
export async function getMessages(ids: string[], step?: (done: number) => void, width = 4): Promise<MailMessage[]> {
  const out: MailMessage[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      out.push(await getMessage(id));
      step?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, ids.length) }, worker));
  return out;
}
