// Turns a batch of emails into bookings to review: reads each one with the Booking.com, Airbnb and GetYourGuide readers,
// keeps only what falls inside the trip's dates, merges several emails about one booking, and sets cancelled ones aside.
// It works on text already in memory and keeps nothing; the only thing remembered between runs is which emails were
// not about this trip (their ids, never their content).
import { parseBookingEmail, type EmailBooking } from './bookingEmail.ts';
import { looksLikeGetYourGuide, mergeActivities, parseGetYourGuide, type ActivityBooking } from './activityEmail.ts';
import type { MailMessage } from './gmail.ts';

export interface Cancelled {
  /** The place or tour, or the email's subject when the name could not be read. */
  title: string;
  /** ISO date of the stay or activity, when it could be read. */
  date?: string;
}
export interface Unreadable {
  subject: string;
  /** ISO date the email arrived. */
  received: string;
}
export interface MailFound {
  stays: EmailBooking[];
  activities: ActivityBooking[];
  cancelled: Cancelled[];
  unreadable: Unreadable[];
  /** Bookings that were read fine but are for dates outside this trip. */
  elsewhere: number;
  /** Mail from these senders that is not a booking (receipts, offers, messages). */
  skipped: number;
  /** Ids of the emails that were not about this trip, so the next run does not read them again. */
  passed: string[];
}

const SITE = /@(?:[\w-]+\.)*(booking\.com|airbnb\.com|getyourguide\.com)\b/i;
const BOOKINGISH = /confirm|reserv|booked|booking|itinerary|your (?:stay|trip)|modif|amend|updated|cancel/i;
const CANCELLED_SUBJECT = /\bcancel(?:l)?ed\b|cancellation (?:confirm|complete)|\bבוטל/i;
const CANCELLED_TOP = /(?:reservation|booking|trip|order|הזמנה)\s+(?:has\s+been\s+|was\s+|is\s+)?(?:cancel(?:l)?ed|בוטלה)|cancellation (?:confirmation|confirmed)/i;

/** True when the email says the booking was cancelled. A confirmation that merely mentions free cancellation is not one. */
export function isCancellation(subject: string, text: string): boolean {
  if (CANCELLED_SUBJECT.test(subject) && !/free cancellation|cancel for free|can cancel/i.test(subject)) return true;
  return CANCELLED_TOP.test(text.slice(0, 400));
}

/** The listing name in an Airbnb cancellation, which has no dates in a form the booking reader accepts. */
function airbnbCancelledName(text: string): string | undefined {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /^reservation cancel(?:l)?ed$/i.test(l));
  const next = i >= 0 ? lines[i + 1] : undefined;
  return next && next.length < 120 ? next : undefined;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const stayKey = (b: EmailBooking) => b.confirmation ?? `${(b.name ?? '').toLowerCase()}|${b.checkIn}`;
const actKey = (a: ActivityBooking) => a.reference ?? `${a.title.toLowerCase()}|${a.date}`;

function mergeStays(list: EmailBooking[]): EmailBooking {
  const out: EmailBooking = { warnings: [] };
  for (const b of list) {
    const o = out as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(b)) if (k !== 'warnings' && v !== undefined && v !== '') o[k] = v;
  }
  out.warnings = [...new Set(list.flatMap((b) => b.warnings))];
  return out;
}

/** Sorts a batch of emails into bookings to review, cancelled ones, ones that could not be read, and counts of the rest. */
export function triage(messages: MailMessage[], trip: { startDate: string; endDate: string }): MailFound {
  const inTrip = (d?: string) => !!d && ISO.test(d) && d >= trip.startDate && d <= trip.endDate;
  const found: MailFound = { stays: [], activities: [], cancelled: [], unreadable: [], elsewhere: 0, skipped: 0, passed: [] };
  const stays = new Map<string, { b: EmailBooking; at: number }[]>();
  const acts = new Map<string, { a: ActivityBooking; at: number }[]>();
  const cancelledKeys = new Map<string, number>();
  const cancelledRefs = new Map<string, number>();

  for (const m of [...messages].sort((x, y) => x.date - y.date)) {
    const body = m.text;
    const withSubject = `${m.subject}\n${body}`;
    const cancelled = isCancellation(m.subject, body);
    const fromSite = SITE.exec(m.from)?.[1]?.toLowerCase();
    const gyg = fromSite === 'getyourguide.com' || looksLikeGetYourGuide(withSubject);

    if (gyg) {
      const a = parseGetYourGuide(withSubject);
      if (cancelled) {
        if (a.reference) cancelledRefs.set(a.reference, m.date);
        if (a.date && !inTrip(a.date)) {
          found.elsewhere++;
          found.passed.push(m.id);
        } else found.cancelled.push({ title: a.title || m.subject, date: ISO.test(a.date) ? a.date : undefined });
        continue;
      }
      if (!a.title || !ISO.test(a.date) || !a.reference) {
        if (BOOKINGISH.test(m.subject) && looksLikeGetYourGuide(withSubject)) found.unreadable.push({ subject: m.subject, received: day(m.date) });
        else {
          found.skipped++;
          found.passed.push(m.id);
        }
        continue;
      }
      if (!inTrip(a.date)) {
        found.elsewhere++;
        found.passed.push(m.id);
        continue;
      }
      const k = actKey(a);
      acts.set(k, [...(acts.get(k) ?? []), { a, at: m.date }]);
      continue;
    }

    if (!fromSite) {
      // an operator's email that quotes a GetYourGuide reference but was not read as one
      found.skipped++;
      found.passed.push(m.id);
      continue;
    }
    const b = parseBookingEmail(body);
    if (cancelled) {
      const key = b.name && b.checkIn ? stayKey(b) : undefined;
      if (b.confirmation) cancelledKeys.set(b.confirmation, m.date);
      if (key) cancelledKeys.set(key, m.date);
      if (b.checkIn && !inTrip(b.checkIn)) {
        found.elsewhere++;
        found.passed.push(m.id);
      } else found.cancelled.push({ title: b.name || airbnbCancelledName(body) || m.subject, date: b.checkIn });
      continue;
    }
    if (!b.name || !b.checkIn || !ISO.test(b.checkIn) || (!b.confirmation && !BOOKINGISH.test(m.subject))) {
      if (BOOKINGISH.test(m.subject) && (b.confirmation || b.checkIn)) found.unreadable.push({ subject: m.subject, received: day(m.date) });
      else {
        found.skipped++;
        found.passed.push(m.id);
      }
      continue;
    }
    if (!inTrip(b.checkIn)) {
      found.elsewhere++;
      found.passed.push(m.id);
      continue;
    }
    const k = stayKey(b);
    stays.set(k, [...(stays.get(k) ?? []), { b, at: m.date }]);
  }

  // a booking is cancelled when a cancellation email came after its last confirmation
  for (const [k, list] of stays) {
    const last = Math.max(...list.map((x) => x.at));
    const merged = mergeStays(list.map((x) => x.b));
    const at = Math.max(cancelledKeys.get(k) ?? 0, merged.confirmation ? (cancelledKeys.get(merged.confirmation) ?? 0) : 0);
    if (at > last) {
      found.cancelled.push({ title: merged.name ?? k, date: merged.checkIn });
      continue;
    }
    found.stays.push(merged);
  }
  for (const [, list] of acts) {
    const last = Math.max(...list.map((x) => x.at));
    const merged = mergeActivities(list.map((x) => x.a));
    if (merged.reference && (cancelledRefs.get(merged.reference) ?? 0) > last) {
      found.cancelled.push({ title: merged.title, date: merged.date });
      continue;
    }
    found.activities.push(merged);
  }
  // the same booking can be reported cancelled by two emails
  const seen = new Set<string>();
  found.cancelled = found.cancelled.filter((c) => !seen.has(`${c.title}|${c.date}`) && !!seen.add(`${c.title}|${c.date}`));
  found.stays.sort((a, b) => (a.checkIn ?? '').localeCompare(b.checkIn ?? ''));
  found.activities.sort((a, b) => a.date.localeCompare(b.date));
  return found;
}

// ---------------------------------------------------------------- what was already judged, this device only

const KEY = 'tl.mail.passed';
/** The ids of emails already judged not to be about this trip, valid while the trip's dates are the same. */
export function loadPassed(trip: { startDate: string; endDate: string }): Set<string> {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { range?: string; ids?: string[] } | null;
    return j?.range === `${trip.startDate}..${trip.endDate}` ? new Set(j.ids ?? []) : new Set();
  } catch {
    return new Set();
  }
}
export function savePassed(trip: { startDate: string; endDate: string }, ids: Iterable<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ range: `${trip.startDate}..${trip.endDate}`, ids: [...ids].slice(-3000) }));
  } catch {
    /* storage unavailable: it just reads them again next time */
  }
}
export function forgetPassed() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
