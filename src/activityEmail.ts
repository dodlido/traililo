import type { Entry, ExperienceEntry, Trip } from './model.ts';
import { findDates } from './bookingEmail.ts';

// Reads a GetYourGuide confirmation, or the tour operator's own itinerary message that GetYourGuide passes on,
// into the facts of one booked activity. It works on labels ("Booking reference", "Cancellation policy", "Check-in:") and
// ignores layout, so the text copied from a phone, from a computer or from the mail app all read the same.
// Whatever it cannot find is left out, and the person checks the rest before anything is saved.

export interface ActivityBooking {
  kind: 'activity';
  /** The tour's name as GetYourGuide has it. */
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** "10:30" */
  startTime?: string;
  endTime?: string;
  durationMin?: number;
  /** For example "GYGAB12CD34EF". */
  reference?: string;
  pin?: string;
  bookedBy?: string;
  provider?: string;
  providerPhone?: string;
  meetingPoint?: string;
  /** When to be at the meeting point, "10:00". */
  arriveBy?: string;
  /** The pick-up arrangement, as written. */
  pickup?: string;
  /** Last moment to cancel for free, in plain words. */
  cancelUntil?: string;
  /** "2 adults" */
  guests?: string;
  /** Costs that are not in the price and are paid on the day. */
  payOnTheDay?: string[];
  /** Things the operator asks the traveller to do. */
  asks?: string[];
  /** Things the reader should double-check, in plain words. */
  warnings: string[];
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plain = (d: string) => `${+d.slice(8)} ${EN_MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

/** "10:30 AM" as "10:30", "7:05 PM" as "19:05". A time without AM or PM is read as a 24-hour clock. */
function clock(h: string, m: string, ap?: string): string {
  let n = +h;
  if (ap) n = (n % 12) + (/^p/i.test(ap) ? 12 : 0);
  return `${String(n).padStart(2, '0')}:${m}`;
}
const addMinutes = (t: string, min: number) => {
  const total = (+t.slice(0, 2) * 60 + +t.slice(3) + min) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const CLOCK = String.raw`(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?`;
const REF = /\bGYG[A-Z0-9]{9,12}\b/;

/** Plain, single-spaced text: link targets, table bars, heading marks and emoji removed. */
function flatten(input: string): string {
  return input
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/\[([^\]]*)\]\((?:https?:|mailto:|tel:|\+|gyg:)[^)]*\)/g, '$1') // [text](link) keeps the text
    .replace(/\(\s*(?:https?:\/\/|\+\d)[^)\s]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[|#*_]+/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}☀-➿️]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksLikeGetYourGuide(text: string): boolean {
  return (/getyourguide/i.test(text) || REF.test(text)) && (/booking reference|your activity provider|activity provider|itinerary|cancellation policy/i.test(text));
}

const trimEnd = (s: string) => s.replace(/[\s.,;:–-]+$/, '').trim();

/** One email, or the text of one. Pass the subject line in front of the body when you have it. */
export function parseGetYourGuide(input: string): ActivityBooking {
  const text = flatten(input);
  const warnings: string[] = [];
  const out: ActivityBooking = { kind: 'activity', title: '', date: '', warnings };

  out.reference = text.match(/booking reference\s*:?\s*(GYG[A-Z0-9]{6,14})/i)?.[1] ?? text.match(REF)?.[0];
  const pin = text.match(/booking reference\s*:?\s*GYG[A-Z0-9]+\s+PIN\s*:?\s*(\S{3,24})/i)?.[1] ?? text.match(/\bPIN\s*:\s*(\S{3,24})/)?.[1];
  if (pin) out.pin = pin;

  // ---- the GetYourGuide confirmation: "March 16, 2027 at 10:30 AM <tour> 2 Adults (Age 18 - 50) • English • 7.5 hours"
  const head = text.match(new RegExp(String.raw`([A-Za-z]{3,9}\.? \d{1,2}, \d{4})\s+at\s+${CLOCK}\s+(.+?)\s+(\d+\s+(?:Adults?|Children|Child|Participants?|Persons?|People|Travell?ers?|Guests?)\b[^•]*?)(?:\s*•|$)`, 'i'));
  if (head) {
    out.date = findDates(head[1])[0]?.iso ?? '';
    out.startTime = clock(head[2], head[3], head[4]);
    out.title = trimEnd(head[5]);
    const n = head[6].match(/^(\d+)\s+(\w+)/);
    if (n) out.guests = `${n[1]} ${n[2].toLowerCase()}`;
    const dur = text.slice(text.indexOf(head[0]) + head[0].length).match(/^[^₪$€£]{0,60}?([\d.]+)\s*(hours?|hrs?|minutes?|mins?)\b/i);
    if (dur) out.durationMin = Math.round(+dur[1] * (/^h/i.test(dur[2]) ? 60 : 1));
  }

  // ---- the operator's own itinerary: "Tour: … Date: … Passengers: 2 … Check-in: 10:00 AM … Departure: 10:30 AM"
  const tour = text.match(/\bTour:\s*(.+?)\s+(?:Date:|Passengers:)/i)?.[1];
  if (tour && !out.title) out.title = trimEnd(tour);
  if (!out.date) {
    const dt = text.match(/\bDate:\s*([A-Za-z]{3,9}\.? \d{1,2},? \d{4})/i)?.[1];
    if (dt) out.date = findDates(dt)[0]?.iso ?? '';
  }
  const pax = text.match(/\bPassengers?:\s*(\d+)/i)?.[1];
  if (pax && !out.guests) out.guests = `${pax} ${+pax === 1 ? 'guest' : 'guests'}`;
  const dep = text.match(new RegExp(String.raw`\bDeparture(?: time)?:\s*${CLOCK}`, 'i'));
  if (dep && !out.startTime) out.startTime = clock(dep[1], dep[2], dep[3]);
  const chk = text.match(new RegExp(String.raw`\bCheck-?in:\s*${CLOCK}`, 'i'));
  if (chk) out.arriveBy = clock(chk[1], chk[2], chk[3]);
  const tot = text.match(/\bTotal duration:\s*(?:approximately|about|around|~)?\s*([\d.]+)\s*(hours?|hrs?|minutes?|mins?)/i);
  if (tot && !out.durationMin) out.durationMin = Math.round(+tot[1] * (/^h/i.test(tot[2]) ? 60 : 1));
  const loc = text.match(/\bLocation:\s*(.+?)\s+(?:Stand:|Map:|IMPORTANT|Hotel pick)/i)?.[1];
  const stand = text.match(/\bStand:\s*(.+?)\s+(?:Map:|IMPORTANT|Hotel pick)/i)?.[1];
  if (loc) out.meetingPoint = trimEnd(loc) + (stand ? ` (${trimEnd(stand)} stand)` : '');

  // ---- where, when, who
  const where = text.match(/\bWhere to go\s+(.+?)\s+(?:When to arrive|Where your activity ends|Important information)/i)?.[1];
  if (where && !out.meetingPoint) {
    const split = where.match(/^(.*?\b(?:Argentina|Chile|Chilean|Argentine)\b)\s*(.*)$/);
    out.meetingPoint = trimEnd(split ? split[1] : where);
    if (split?.[2]) out.meetingPoint += `. ${trimEnd(split[2])}`;
  }
  const arrive = text.match(new RegExp(String.raw`\bWhen to arrive\s+${CLOCK}`, 'i'));
  if (arrive) out.arriveBy = clock(arrive[1], arrive[2], arrive[3]);
  const pick = text.match(/\b(Pick-?up (?:is|will be|starts)[^.]*?\d{1,2}:\d{2}\s*[AP]M)/i)?.[1] ?? text.match(/\b(Pick-?up (?:is|will be)[^.]*\.)/i)?.[1];
  if (pick) out.pickup = trimEnd(pick.replace(/^Pick-?up\s+(?:is|will be)\s*/i, ''));
  if (/hotel pick-?up and drop-?off are not included|no (?:hotel )?pick-?up/i.test(text)) out.pickup = 'Not included. Make your own way to the meeting point.';

  const prov = text.match(/\bYour activity provider is\s+(.+?)\s+(?:Contact them|Email|\+\d)/i)?.[1] ?? text.match(/\bGreetings from ([^!.]+?)!/i)?.[1] ?? text.match(/^\s*([A-Z][\w ]+?):\s+To\b/)?.[1];
  if (prov) out.provider = trimEnd(prov);
  const phone =
    text.match(/\bYour activity provider is\s+.+?\s+Contact them[^+]*?(\+\d[\d ]{8,18}\d)/i)?.[1] ??
    text.match(/(?:phone or whatsapp|whatsapp|phone|tel)\s*:?\s*(\+\d[\d ]{8,18}\d)/i)?.[1] ??
    text.match(/(\+\d[\d ]{9,18}\d)/)?.[1];
  if (phone) out.providerPhone = phone.replace(/\s+/g, ' ').trim();

  // ---- cancelling
  const c = text.match(new RegExp(String.raw`Cancel before\s+${CLOCK}\s+on\s+([A-Za-z]{3,9}\.? \d{1,2}, \d{4})`, 'i'));
  if (c) {
    const d = findDates(c[4])[0]?.iso;
    if (d) out.cancelUntil = `${plain(d)} ${clock(c[1], c[2], c[3])}`;
  } else {
    const f = text.match(/\b(Free cancellation[^.]{0,80}\.)/i)?.[1];
    if (f) out.cancelUntil = trimEnd(f.replace(/^Free cancellation\s*/i, ''));
  }

  // ---- costs not in the price
  const fees: string[] = [];
  for (const m of text.matchAll(/([A-Z][A-Za-z' ]{2,40}?\s(?:Fee|Fees|Tax|Surcharge|Charge)):\s*((?:ARS|USD|CLP|EUR|BRL|[€$£])\s?[\d.,]+(?:\s*(?:per person|each|pp|per adult))?)/g)) fees.push(`${m[1].trim()}: ${m[2].trim()}`);
  if (fees.length) out.payOnTheDay = fees;

  // ---- what the operator wants from the traveller
  const asks: string[] = [];
  if (/medical form/i.test(text)) asks.push('fill in the medical form the operator emails');
  if (/passport|DNI|date of birth/i.test(text) && /(inform|send|add|provide|personal details)/i.test(text)) asks.push('send the operator your passport details and date of birth');
  if (asks.length) out.asks = asks;

  // ---- what to double-check
  if (/still needs to be confirmed|confirmation pending/i.test(text) && !/thanks for your order|ticket instructions|your tickets are ready/i.test(text)) warnings.push('GetYourGuide says the operator had not yet confirmed this booking.');
  if (!out.title) warnings.push('I could not find the tour name.');
  if (!out.date) warnings.push('I could not find the date.');
  if (!out.reference) warnings.push('I could not find the booking reference.');
  return out;
}

/** The same booking from several emails (pending, confirmed, the operator's update) as one. Later emails win where they say something. */
export function mergeActivities(list: ActivityBooking[]): ActivityBooking {
  const out: ActivityBooking = { kind: 'activity', title: '', date: '', warnings: [] };
  for (const a of list) {
    const o = out as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(a)) {
      if (k === 'warnings') continue;
      if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) o[k] = v;
    }
  }
  // a later email that does not carry the "not yet confirmed" notice means it was confirmed since
  const confirmedAfter = list.some((a, i) => i > 0 && !a.warnings.some((w) => /not yet confirmed/.test(w)));
  const missing: Record<string, unknown> = { 'I could not find the booking reference.': out.reference, 'I could not find the tour name.': out.title, 'I could not find the date.': out.date };
  out.warnings = [...new Set(list.flatMap((a) => a.warnings))].filter((w) => !(confirmedAfter && /not yet confirmed/.test(w)) && !missing[w]);
  return out;
}

// ---------------------------------------------------------------- putting a booking into the trip

/** The lines an activity booking adds to an entry's private notes. They start with fixed words so a later import can replace them. */
export const ACTIVITY_NOTE = /^(?:pin|provider|meeting point|arrive by|starts at|pick-?up|free cancellation|to pay on the day|to do before the day)\b/i;
const STALE_POINTER = /\bget-?\s?your-?\s?guide\b/i; // a note like "my get-your-guide": a reminder that the details lived in the app

export function activityNotes(a: ActivityBooking): string[] {
  return [
    a.pin && `PIN: ${a.pin}`,
    (a.provider || a.providerPhone) && `Provider: ${[a.provider, a.providerPhone].filter(Boolean).join(', ')}`,
    a.meetingPoint && `Meeting point: ${a.meetingPoint}`,
    a.arriveBy && `Arrive by ${a.arriveBy}`,
    a.pickup && `Pick-up: ${a.pickup}`,
    a.cancelUntil && `Free cancellation until ${a.cancelUntil}`,
    a.payOnTheDay?.length && `To pay on the day: ${a.payOnTheDay.join('; ')}`,
    a.asks?.length && `To do before the day: ${a.asks.join('; ')}`,
  ].filter((x): x is string => !!x);
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !['tour', 'with', 'from', 'full', 'walk', 'trip', 'guide', 'guided'].includes(w));

export interface ActivityMatch {
  /** match: an entry on that day is this booking. new: nothing there yet. */
  kind: 'match' | 'new';
  entry?: Entry;
}

/** Which of the day's entries a booking belongs to. */
export function matchActivity(trip: Trip, a: ActivityBooking): ActivityMatch {
  const day = trip.days.find((d) => d.date === a.date);
  if (!day) return { kind: 'new' };
  const doing = day.entries.filter((e) => e.kind === 'experience' || e.kind === 'hike');
  const byCode = a.reference ? doing.find((e) => e.booking?.confirmationCode === a.reference) : undefined;
  if (byCode) return { kind: 'match', entry: byCode };
  const aw = words(a.title);
  const scored = doing
    .map((e) => ({ e, s: words(e.title).filter((w) => aw.some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))).length * 2 + (e.booking?.source === 'getyourguide' ? 3 : 0) }))
    .sort((p, q) => q.s - p.s);
  if (scored[0] && scored[0].s > 0 && scored[0].s > (scored[1]?.s ?? 0)) return { kind: 'match', entry: scored[0].e };
  if (doing.length === 1) return { kind: 'match', entry: doing[0] };
  return { kind: 'new' };
}

/** The entry after a booking is applied to it. A matched entry keeps its own title; a new one is an experience. */
export function applyActivity(base: Entry | undefined, a: ActivityBooking, id: string): Entry {
  const e: Entry = base ? structuredClone(base) : { id, kind: 'experience', title: a.title, notes: [], warnings: [], links: [], privateNotes: [] };
  e.booking = { ...e.booking, source: 'getyourguide', ...(a.bookedBy && !e.booking?.bookedBy ? { bookedBy: a.bookedBy } : {}), ...(a.reference ? { confirmationCode: a.reference } : {}) };
  if (e.kind === 'experience') {
    const x = e as ExperienceEntry;
    if (a.startTime) {
      x.startTime = a.startTime;
      if (a.durationMin) {
        x.endTime = addMinutes(a.startTime, a.durationMin);
        x.durationMin = a.durationMin;
      }
    }
  }
  const mine = activityNotes(a);
  const keep = (e.privateNotes ?? []).filter((l) => !ACTIVITY_NOTE.test(l) && !(STALE_POINTER.test(l) && l.length < 90));
  // a hike or other entry that has no start time field keeps the time in its notes
  if (e.kind !== 'experience' && a.startTime) mine.unshift(`Starts at ${a.startTime}`);
  e.privateNotes = [...keep, ...mine];
  return e;
}
