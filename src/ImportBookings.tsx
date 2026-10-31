// Fills in several stays at once from a file of parsed booking confirmations.
// Each booking is matched to a stay by night and name, and shown for approval before anything is saved.
import { useMemo, useState } from 'react';
import type { Entry, Stay, Trip } from './model.ts';
import { applyBooking, matchStay, type BookingMatch, type EmailBooking } from './bookingEmail.ts';
import { applyActivity, looksLikeGetYourGuide, matchActivity, parseGetYourGuide, type ActivityBooking, type ActivityMatch } from './activityEmail.ts';
import { findStayPin } from './geocode.ts';
import { Actions, Sheet, useSave } from './Edit.tsx';
import { connect, connected, disconnect, getMessages, gmailAvailable, listIds, MailError, MONTHS_BACK, searchFor, SENDERS } from './gmail.ts';
import { forgetPassed, loadPassed, savePassed, triage, type MailFound } from './mailImport.ts';

type Mutate = (fn: (t: Trip) => void) => Promise<void>;
interface Row {
  b: EmailBooking;
  m: BookingMatch;
  on: boolean;
  outside: boolean;
  /** Already in the trip with this confirmation code. */
  same?: boolean;
}
/** A booked tour or activity, matched to the day's entry. */
interface ActRow {
  a: ActivityBooking;
  m: ActivityMatch;
  on: boolean;
  outside: boolean;
  same?: boolean;
}

const day = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Puts a booked activity on its day: in place of the entry it matched, or added to the day. */
function placeActivity(t: Trip, a: ActivityBooking, e: Entry) {
  const day = t.days.find((d) => d.date === a.date);
  if (!day) return;
  day.entries = day.entries.some((x) => x.id === e.id) ? day.entries.map((x) => (x.id === e.id ? e : x)) : [...day.entries, e];
}

/** Puts a stay in the trip and ties it to the days it covers. */
function placeStay(t: Trip, out: Stay) {
  t.stays = t.stays.some((q) => q.id === out.id) ? t.stays.map((q) => (q.id === out.id ? out : q)) : [...t.stays, out];
  for (const dd of t.days) if (dd.stayId === out.id) delete dd.stayId;
  for (let i = 0; i < out.nights; i++) {
    const dd = t.days.find((q) => q.date === addDays(out.checkIn, i));
    if (dd) {
      dd.stayId = out.id;
      if (!dd.point && out.point) dd.point = out.point;
    }
  }
}

export function ImportBookings({ trip, mutate, onClose }: { trip: Trip; mutate: Mutate; onClose: () => void }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [acts, setActs] = useState<ActRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [mail, setMail] = useState<{ working: string | null; found: MailFound | null; error: string | null }>({ working: null, found: null, error: null });
  const { busy, error, run } = useSave(mutate, onClose);
  const dates = useMemo(() => new Set(trip.days.map((d) => d.date)), [trip]);

  const actRows = (list: ActivityBooking[]): ActRow[] =>
    list.map((a) => {
      const m = matchActivity(trip, a);
      const outside = !dates.has(a.date);
      const same = m.kind === 'match' && !!a.reference && m.entry?.booking?.confirmationCode === a.reference;
      return { a, m, on: m.kind === 'match' && !outside && !same, outside, same };
    });

  const stayRows = (list: EmailBooking[]): Row[] =>
    list.map((b) => {
      const m = matchStay(trip.stays, b);
      const outside = !dates.has(b.checkIn!);
      const same = m.kind === 'match' && !!b.confirmation && m.stay?.booking?.confirmationCode === b.confirmation;
      return { b, m, on: m.kind === 'match' && !outside && !same, outside, same };
    });

  /** Signs in to Google if needed, reads the booking emails on this device, and shows what they hold. */
  const findInMail = async () => {
    setMail({ working: 'Opening Google…', found: null, error: null });
    try {
      if (!connected()) await connect();
      setMail((x) => ({ ...x, working: 'Looking for booking emails…' }));
      const passed = loadPassed(trip);
      const ids = (await listIds(searchFor())).filter((id) => !passed.has(id));
      const msgs = await getMessages(ids, (d) => setMail((x) => ({ ...x, working: `Reading emails… ${d} of ${ids.length}` })));
      const found = triage(msgs, trip);
      savePassed(trip, [...passed, ...found.passed]);
      setMail({ working: null, found, error: null });
      setActs(actRows(found.activities));
      setRows(stayRows(found.stays));
    } catch (e) {
      setMail({ working: null, found: null, error: e instanceof MailError ? e.message : 'Something went wrong while reading your mail.' });
    }
  };
  const signOut = async () => {
    await disconnect();
    forgetPassed();
    setMail({ working: null, found: null, error: null });
  };

  const load = (raw: string) => {
    setMsg(null);
    let j: { traililo?: string; bookings?: EmailBooking[]; activities?: ActivityBooking[] } | null = null;
    try {
      j = JSON.parse(raw);
    } catch {
      /* not a file: it may be the text of one GetYourGuide email */
    }
    if (!j) {
      if (!looksLikeGetYourGuide(raw)) return setMsg('That does not look like a bookings file or a GetYourGuide email.');
      const a = parseGetYourGuide(raw);
      if (!a.title || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return setMsg(a.warnings.join(' ') || 'I could not read that email.');
      setRows([]);
      return setActs(actRows([a]));
    }
    if (j.traililo !== 'bookings' || (!Array.isArray(j.bookings) && !Array.isArray(j.activities))) return setMsg('That does not look like a bookings file.');
    const ok = (j.bookings ?? []).filter((b) => b && typeof b.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.checkIn ?? ''));
    const okActs = (j.activities ?? []).filter((a) => a && typeof a.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '')).map((a) => ({ ...a, warnings: Array.isArray(a.warnings) ? a.warnings : [] }));
    if (!ok.length && !okActs.length) return setMsg('That file has no bookings in it.');
    setActs(actRows(okActs));
    setRows(stayRows(ok));
  };
  const pick = async (f?: File) => f && load(await f.text());

  const apply = async () => {
    const chosen = (rows ?? []).filter((r) => r.on);
    const out: Stay[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const { b, m } = chosen[i];
      const s = applyBooking(m.stay, b, m.kind, m.stay?.id ?? `stay-${Math.random().toString(36).slice(2, 8)}`);
      if ((!s.point || s.point.approx) && !b.point) {
        setProgress(`Finding map pins… ${i + 1} of ${chosen.length}`);
        if (i) await sleep(1100);
        const pin = await findStayPin(s.name, b.address);
        if (pin) s.point = pin.point;
      }
      out.push(s);
    }
    setProgress(null);
    const chosenActs = acts.filter((r) => r.on).map((r) => ({ a: r.a, e: applyActivity(r.m.entry, r.a, r.m.entry?.id ?? `${r.a.date}-gyg-${Math.random().toString(36).slice(2, 7)}`) }));
    run((t) => {
      for (const s of out) placeStay(t, s);
      for (const { a, e } of chosenActs) placeActivity(t, a, e);
    });
  };
  const n = (rows?.filter((r) => r.on).length ?? 0) + acts.filter((r) => r.on).length;
  const what = (b: EmailBooking) => [b.confirmation && 'confirmation', b.address && 'address', b.phone && 'phone', b.pin && 'PIN', b.cancelUntil && 'cancel-by', b.point && 'map pin'].filter(Boolean).join(', ');

  return (
    <Sheet title="Import bookings" onClose={onClose}>
      {!rows ? (
        <>
          {gmailAvailable() && (
            <section className="mail-find">
              <button type="button" className="chip" disabled={!!mail.working} onClick={findInMail}>{connected() ? 'Find in my mail' : 'Connect Gmail and find bookings'}</button>
              {mail.working && <p className="hint">{mail.working}</p>}
              {mail.error && <p className="error">{mail.error}</p>}
              <p className="hint">
                Searches your Gmail for the last {MONTHS_BACK} months of email from {SENDERS.join(', ')}, and keeps only bookings for this trip’s dates. Your email is read on this device. It is not sent to
                TraiLilo or anyone else, and nothing is saved until you confirm. Read-only: the app cannot change or send mail.
              </p>
              {connected() && <button type="button" className="link-btn" onClick={signOut}>Disconnect Gmail</button>}
            </section>
          )}
          <p className="hint">Choose the bookings file, or paste its text. A GetYourGuide confirmation email pasted here works too. Nothing is saved until you confirm on the next screen.</p>
          <input type="file" accept="application/json,.json,text/plain" onChange={(e) => pick(e.target.files?.[0])} />
          <textarea rows={4} value={text} placeholder="…or paste the file text here" onChange={(e) => setText(e.target.value)} />
          <button type="button" className="chip" disabled={!text.trim()} onClick={() => load(text)}>Read it</button>
          {msg && <p className="error">{msg}</p>}
        </>
      ) : (
        <>
          <p className="hint">Tick what to import. Bookings for a stay you already have are ticked. The others are not, because they would replace or add a place.</p>
          <ul className="import-rows">
            {rows.map((r, i) => (
              <li key={i}>
                <label className="check">
                  <input type="checkbox" checked={r.on} disabled={r.outside} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
                  <span>
                    <strong>{r.b.name}</strong> · {day(r.b.checkIn!)}
                    {r.b.checkOut ? ` to ${day(r.b.checkOut)}` : ''}
                    <small className="import-sub">
                      {r.outside
                        ? 'Outside this trip’s dates.'
                        : r.same
                          ? 'Already imported. Tick to read it in again.'
                          : r.m.kind === 'match'
                          ? `Fills in your stay “${r.m.stay!.name}”: ${what(r.b)}.`
                          : r.m.kind === 'replace'
                            ? `Replaces “${r.m.stay!.name}” on those nights.`
                            : 'Adds a new place to sleep.'}
                    </small>
                  </span>
                </label>
              </li>
            ))}
            {acts.map((r, i) => (
              <li key={`a${i}`}>
                <label className="check">
                  <input type="checkbox" checked={r.on} disabled={r.outside} onChange={(e) => setActs(acts.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
                  <span>
                    <strong>{r.m.entry?.title ?? r.a.title}</strong> · {day(r.a.date)}
                    {r.a.startTime ? ` at ${r.a.startTime}` : ''}
                    <small className="import-sub">
                      {r.outside
                        ? 'Outside this trip’s dates.'
                        : r.same
                          ? 'Already imported. Tick to read it in again.'
                          : r.m.kind === 'match'
                          ? `Fills in your ${r.m.entry!.kind === 'hike' ? 'hike' : 'activity'} “${r.m.entry!.title}”: ${[r.a.reference && 'booking reference', r.a.startTime && 'time', r.a.meetingPoint && 'meeting point', r.a.provider && 'provider', r.a.cancelUntil && 'cancel-by', r.a.pin && 'PIN'].filter(Boolean).join(', ')}.`
                          : 'Adds a new activity to that day.'}
                      {r.a.warnings.length ? ` ${r.a.warnings.join(' ')}` : ''}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {mail.found && <MailNotes f={mail.found} empty={!rows.length && !acts.length} />}
          <Actions onSave={apply} busy={busy || !!progress || n === 0} error={error} />
          {progress && <p className="hint">{progress}</p>}
          <button type="button" className="link-btn" onClick={() => { setRows(null); setActs([]); setMail((x) => ({ ...x, found: null })); }}>{mail.found ? 'Back' : 'Choose another file'}</button>
        </>
      )}
    </Sheet>
  );
}

/** What the mail search set aside, in plain words, so nothing is silently dropped. */
function MailNotes({ f, empty }: { f: MailFound; empty: boolean }) {
  const lines: string[] = [];
  lines.push(`Read ${f.read} new email${f.read === 1 ? '' : 's'}${f.readGyg ? `, ${f.readGyg} from GetYourGuide` : ', none from GetYourGuide'}. Emails already found not to be about this trip are skipped.`);
  if (empty) lines.push('No bookings for this trip’s dates were found in your mail.');
  if (f.cancelled.length) lines.push(`Cancelled, so left out: ${f.cancelled.map((c) => `${c.title}${c.date ? ` (${day(c.date)})` : ''}`).join('; ')}.`);
  if (f.unreadable.length) lines.push(`Could not read ${f.unreadable.length} email${f.unreadable.length > 1 ? 's' : ''}, add by hand if needed: ${f.unreadable.map((u) => `“${u.subject}” (${day(u.received)})`).join('; ')}.`);
  if (f.elsewhere) lines.push(`${f.elsewhere} other booking email${f.elsewhere > 1 ? 's were' : ' was'} for dates outside this trip.`);
  if (f.skipped) lines.push(`${f.skipped} email${f.skipped > 1 ? 's' : ''} from those senders ${f.skipped > 1 ? 'were' : 'was'} not a booking.`);
  return (
    <>
      {lines.map((l) => (
        <p key={l} className="hint">{l}</p>
      ))}
    </>
  );
}
