import type { Stay, StayType } from './model.ts';

// Reads the text of a Booking.com confirmation email (pasted in) into the fields of a stay.
// It works on labels ("Check-in", "Confirmation number", "PIN code") and is forgiving about layout, so a copy from a
// phone (label and value on separate lines) and a copy from a computer (label: value) both work.
// English and Hebrew wording. Whatever it cannot find is simply left out, and the person checks the rest before saving.

export interface EmailBooking {
  name?: string;
  address?: string;
  phone?: string;
  /** The town, when the email says "Your booking in <town>". */
  town?: string;
  /** Last moment to cancel for free, as written in the email. */
  cancelUntil?: string;
  confirmation?: string;
  pin?: string;
  /** ISO dates, YYYY-MM-DD. */
  checkIn?: string;
  checkOut?: string;
  /** As written in the email, for example "14:00" or "14:00–23:00". */
  checkInTime?: string;
  checkOutTime?: string;
  /** Things the reader should double-check, in plain words. */
  warnings: string[];
}

const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthNum = (w: string) => (MONTH.test(w) ? MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1 : 0);

const HEB = ['ינואר', 'פברואר', 'מרץ|מרס', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const hebMonth = (w: string) => HEB.findIndex((h) => new RegExp(`^(?:${h})$`).test(w)) + 1;
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2027-02-15" as "15 Feb 2027". */
const plain = (d: string) => `${+d.slice(8)} ${EN_MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

function iso(y: number, m: number, d: number): string | undefined {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return undefined;
  return t.toISOString().slice(0, 10);
}

interface Found {
  iso: string;
  start: number;
  end: number;
  ambiguous?: boolean;
}

/** Every date in a piece of text, in the order it appears. */
export function findDates(s: string): Found[] {
  const out: Found[] = [];
  const add = (m: RegExpMatchArray, v: string | undefined, ambiguous = false) => {
    if (v) out.push({ iso: v, start: m.index!, end: m.index! + m[0].length, ambiguous });
  };
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(m, iso(+m[1], +m[2], +m[3]));
  for (const m of s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) add(m, iso(+m[3], monthNum(m[2]), +m[1]));
  for (const m of s.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) add(m, iso(+m[3], monthNum(m[1]), +m[2]));
  for (const m of s.matchAll(new RegExp(`(\\d{1,2})\\s+ב?(${HEB.join('|')})\\s+(\\d{4})`, 'g'))) add(m, iso(+m[3], hebMonth(m[2]), +m[1]));
  for (const m of s.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g)) add(m, iso(+m[3], +m[2], +m[1]), +m[1] <= 12 && +m[2] <= 12);
  return out.sort((a, b) => a.start - b.start);
}

/** Whole days from one ISO date to another. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

const clean = (s: string) =>
  s
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/\[[\w.-]+\.(?:png|gif|jpe?g|svg)\]/gi, ''); // icon names that come along when an email is copied as text

/** "14:00" or "14:00–23:00", read from the text right after a date. Handles 12-hour times like "1:00 PM". */
function timeAfter(text: string, from: number): string | undefined {
  const w = text.slice(from, from + 70).split(/check[\s-]?(?:in|out)|צ['׳’]?ק[\s-]?(?:אין|אאוט)/i)[0];
  const T = String.raw`(\d{1,2})[:.](\d{2})\s*([AaPp]\.?[Mm]\.?)?`;
  const m = w.match(new RegExp(`${T}(?:\\s*(?:[-–—]|to)\\s*${T})?`));
  if (!m) return undefined;
  const t = (h: string, min: string, ap?: string) => {
    let n = +h;
    if (ap) {
      const pm = /^p/i.test(ap);
      n = (n % 12) + (pm ? 12 : 0);
    }
    return `${String(n).padStart(2, '0')}:${min}`;
  };
  const a = t(m[1], m[2], m[3]);
  return m[4] ? `${a}–${t(m[4], m[5], m[6])}` : a;
}

const NOT_A_NAME = /^(thank|your booking|booking (?:is )?confirm|reservation|confirmed|hi\b|hello|dear|view|manage|show|get directions|see |check[\s-]?(?:in|out)|confirmation|pin|address|phone|total|price|genius|free cancellation|we\b|here|booking\.com)/i;
const LINK_TEXT = /^(show (?:on )?map|view (?:on )?map|get directions|see (?:on )?map|map)$/i;

function looksLikeAddress(l: string): boolean {
  if (l.length < 12 || l.length > 140 || l.split(' ').length > 20) return false;
  if (/[a-z]{3}[.!?] [A-Z]/.test(l)) return false; // two sentences is a paragraph, not an address
  if ((l.match(/,/g) ?? []).length < 2) return false;
  if (/[@€$£₪]|https?:|total|price|cancel/i.test(l)) return false;
  if (findDates(l).length) return false;
  return true;
}

function tidyName(s: string): string | undefined {
  const n = s
    .replace(/\(\s*\d{6,}\s*\)\s*$/, '')
    .replace(/\s*[★⭐]+\s*$/u, '')
    .replace(/\s+(?:is|has been)\s+confirmed.*$/i, '')
    .replace(/^["“'‘]+|["”'’.:]+$/g, '')
    .trim();
  if (n.length < 2 || n.length > 100 || /^\d+$/.test(n) || findDates(n).length) return undefined;
  return n;
}

export function parseBookingEmail(input: string): EmailBooking {
  const text = clean(input);
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const warnings: string[] = [];
  const out: EmailBooking = { warnings };

  // confirmation number and PIN
  const conf =
    text.match(/(?:מספר\s+אישור(?:\s+הזמנה)?|אישור\s+הזמנה|מספר\s+הזמנה)\s*[:#]?\s*(\d[\d. ]{6,16}\d)/)?.[1] ??
    text.match(/(?:confirmation|booking|reservation)\s*(?:number|no\.?|#|code|id)\s*[:#]?\s*(\d[\d. ]{6,16}\d)/i)?.[1] ??
    text.match(/\bconfirmation\s*[:#]\s*(\d[\d. ]{6,16}\d)/i)?.[1] ??
    text.match(/\((\d{8,12})\)/)?.[1];
  const digits = conf?.replace(/\D/g, '');
  if (digits && digits.length >= 8 && digits.length <= 12) out.confirmation = digits;
  const pin = text.match(/(?:\bPIN(?:\s*code)?|קוד\s+סודי|קוד\s+PIN)\s*[:#]?\s*(\d{4})\b/i)?.[1];
  if (pin) out.pin = pin;

  // dates: look after the "Check-in" and "Check-out" labels, otherwise take the first two dates
  const after = (label: RegExp) => {
    for (const m of text.matchAll(label)) {
      const from = m.index! + m[0].length;
      const d = findDates(text.slice(from, from + 90))[0];
      if (d) return { ...d, start: from + d.start, end: from + d.end };
    }
    return undefined;
  };
  let inD = after(/check[\s-]?in|צ['׳’]?ק[\s-]?אין/gi) ?? after(/\barrival\b/gi);
  let outD = after(/check[\s-]?out|צ['׳’]?ק[\s-]?אאוט/gi) ?? after(/\bdeparture\b/gi);
  if (!inD && !outD) {
    const all = findDates(text);
    if (all.length >= 2) [inD, outD] = [all[0], all[1]];
  }
  if (inD) {
    out.checkIn = inD.iso;
    out.checkInTime = timeAfter(text, inD.end);
  }
  if (outD) {
    out.checkOut = outD.iso;
    out.checkOutTime = timeAfter(text, outD.end);
  }
  if (inD?.ambiguous || outD?.ambiguous) warnings.push('The dates were written as numbers, and I read them as day/month/year. Check them.');
  if (out.checkIn && out.checkOut && daysBetween(out.checkIn, out.checkOut) < 1) {
    warnings.push('The check-out date is not after the check-in date. Check the dates.');
    delete out.checkOut;
    delete out.checkOutTime;
  }

  // phone
  const phone = text.match(/(?:phone|tel(?:ephone)?|טלפון)(?:\s*number)?\s*[:#]?\s*(\+?\d[\d ().-]{6,20}\d)/i)?.[1];
  if (phone) out.phone = phone.trim();

  // address: a labelled line, otherwise the first line that looks like "street, town, country"
  let addrIdx = -1;
  const labelled = lines.findIndex((l, i) => {
    const m = l.match(/^(?:address|location|כתובת|מיקום)(?![\p{L}])\s*:?\s*(.*)$/iu);
    return !!m && (m[1] || lines[i + 1] || '').includes(',');
  });
  if (labelled >= 0) {
    const rest = lines[labelled].replace(/^(?:address|location|כתובת|מיקום)(?![\p{L}])\s*:?\s*/iu, '');
    if (rest.length > 5) {
      out.address = rest;
      addrIdx = labelled;
    } else {
      out.address = lines[labelled + 1];
      addrIdx = labelled + 1;
    }
  }
  if (!out.address) {
    // the address line is usually the one followed by a "get directions" link
    addrIdx = lines.findIndex((l) => /הצגת הוראות נסיעה|get directions|show (?:on )?map|view (?:on )?map/i.test(l) && (l.match(/,/g) ?? []).length >= 2);
    if (addrIdx >= 0) out.address = lines[addrIdx];
  }
  if (!out.address) {
    addrIdx = lines.findIndex(looksLikeAddress);
    if (addrIdx >= 0) out.address = lines[addrIdx];
  }
  if (out.address) out.address = out.address.replace(/\s*[-–—]?\s*(?:הצגת הוראות נסיעה|show (?:on )?map|view (?:on )?map|get directions)\s*$/i, '').trim();

  // town and free-cancellation deadline
  const town = text.match(/\byour \w+ in ([^\n.!]+?) is confirmed/i)?.[1];
  if (town) out.town = town.trim();
  const cancel = text.match(/cancel for free until\s+([^\n\[]*?\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1];
  const cancelHe = text.match(/(?:עלות הביטול|בחינם עד)\s*:?\s*(?:עד\s+)?([^\n:]*?\d{1,2}:\d{2})/)?.[1];
  const until = cancel ?? cancelHe;
  if (until) {
    let u = until.replace(/\s+/g, ' ').trim();
    const f = findDates(u)[0];
    if (f) u = u.slice(0, f.start) + plain(f.iso) + u.slice(f.end); // write the date in English, whatever language it came in
    out.cancelUntil = u;
  }

  // name: "X is expecting you", "booking for/at X", a labelled line, or the line just above the address
  const expecting = text.match(/^\s*(.+?) is expecting you\b/im)?.[1];
  if (expecting) out.name = tidyName(expecting);
  // the subject line, if it was pasted too: "Your booking is confirmed at X"
  if (!out.name) out.name = tidyName(text.match(/\bconfirmed at ([^\n]+)/i)?.[1] ?? '');
  // the property's name sits on its own line just before the "Stay safe online" notice
  if (!out.name) {
    const k = lines.findIndex((l) => /^stay safe online/i.test(l));
    if (k > 0 && !NOT_A_NAME.test(lines[k - 1]) && !/[.:]$/.test(lines[k - 1])) out.name = tidyName(lines[k - 1]);
  }
  if (!out.name) out.name = tidyName(text.match(/please inform (.+?) in advance/i)?.[1] ?? '');
  if (!out.name) out.name = tidyName(text.match(/כדאי לעדכן את (.+?) מראש/)?.[1] ?? '');
  if (!out.name) for (const l of lines) {
    const m = l.match(/(?:booking|reservation)\s+(?:confirmation\s+)?(?:for|at)\s+(.+)$/i);
    const n = m && tidyName(m[1].split(/\s[-–—|]\s/)[0]);
    if (n) {
      out.name = n;
      break;
    }
  }
  if (!out.name) {
    const m = text.match(/^\s*(?:property|accommodation|hotel)\s*:\s*(.+)$/im);
    out.name = m ? tidyName(m[1]) : undefined;
  }
  if (!out.name && addrIdx > 0) {
    let i = addrIdx - 1;
    while (i >= 0 && LINK_TEXT.test(lines[i])) i--;
    const prev = lines[i];
    if (prev && !NOT_A_NAME.test(prev) && !/^(you|\d)/i.test(prev) && !/:\s*$/.test(prev)) out.name = tidyName(prev);
  }

  if (!out.name) warnings.push('I could not find the place name. Type it in.');
  if (!out.checkIn) warnings.push('I could not find the check-in date.');
  return out;
}

/** The town from an address like "Av. San Martin 123, 9301 El Chaltén, Santa Cruz, Argentina". A guess, shown for checking. */
export function townOf(address: string): string | undefined {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return undefined;
  for (const p of parts.slice(1, -1)) {
    const t = p.replace(/\S*\d\S*/g, '').replace(/\s+/g, ' ').trim(); // drop street numbers and postcodes
    if ((t.match(/\p{L}/gu) ?? []).length >= 3 && !/[\u0590-\u05FF]/.test(t)) return t; // the town shows to friends, so only Latin-script names
  }
  return undefined;
}

/** The stay type that fits a name, when the name says so. Hotels are the default, so they return nothing. */
export function guessType(name: string): 'lodge' | 'refugio' | 'camp' | 'glamping' | 'other' | undefined {
  if (/refugio/i.test(name)) return 'refugio';
  if (/glamping|domo|dome/i.test(name)) return 'glamping';
  if (/camp(?:ing|site|ground)?\b/i.test(name)) return 'camp';
  if (/lodge|cabin|cabaña|cabana|posada|hosteria|hostería/i.test(name)) return 'lodge';
  if (/departamento|apartment|apart-?hotel|\bflat\b/i.test(name)) return 'other';
  return undefined;
}

/** The lines a booking adds to a stay's private notes. They start with fixed words so a later import can replace them. */
export const BOOKING_NOTE = /^(address|phone|pin|check-in|free cancellation)\b/i;
export function bookingNotes(r: EmailBooking): string[] {
  const times =
    (r.checkInTime || r.checkOutTime) &&
    [
      r.checkInTime && `Check-in ${r.checkInTime.includes('–') ? '' : 'from '}${r.checkInTime}`,
      r.checkOutTime && `check-out ${r.checkOutTime.includes('–') ? '' : 'until '}${r.checkOutTime}`,
    ]
      .filter(Boolean)
      .join(', ');
  return [
    r.address && `Address: ${r.address}`,
    r.phone && `Phone: ${r.phone}`,
    r.pin && `PIN: ${r.pin}`,
    r.cancelUntil && `Free cancellation until ${r.cancelUntil}`,
    times,
  ].filter((x): x is string => !!x);
}

// ---------------------------------------------------------------- importing a file of several bookings


const addDay = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const SKIP = new Set(['hotel', 'lodge', 'casa', 'home', 'cabana', 'cabaña', 'hosteria', 'hostería', 'posada', 'apartment', 'departamento', 'departamentos']);
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !SKIP.has(w));

export interface BookingMatch {
  /** match: same place, fill it in. replace: another place on the same night(s). new: nothing booked those nights. */
  kind: 'match' | 'replace' | 'new';
  stay?: Stay;
}

/** Which of the trip's stays a booking belongs to. */
export function matchStay(stays: Stay[], b: EmailBooking): BookingMatch {
  if (!b.checkIn) return { kind: 'new' };
  const end = b.checkOut ?? addDay(b.checkIn, 1);
  const overlap = stays.filter((s) => s.checkIn < end && s.checkOut > b.checkIn!);
  const bw = words(b.name ?? '');
  const same = overlap.find((s) => words(s.name).some((w) => bw.includes(w)));
  if (same) return { kind: 'match', stay: same };
  const first = overlap.find((s) => s.checkIn === b.checkIn) ?? overlap[0];
  return first ? { kind: 'replace', stay: first } : { kind: 'new' };
}

/** The stay after a booking is applied to it. A matched stay keeps its own name; a replaced or new one takes the booking's. */
export function applyBooking(base: Stay | undefined, b: EmailBooking, kind: BookingMatch['kind'], id: string): Stay {
  const s: Stay = base ? structuredClone(base) : { id, name: '', type: 'hotel', checkIn: b.checkIn!, checkOut: b.checkOut!, nights: 1, notes: [], privateNotes: [] };
  const rename = kind !== 'match' || !!s.nameIsPlaceholder;
  if (b.name && rename) s.name = b.name;
  const t = b.name ? guessType(b.name) : undefined;
  if (t) s.type = t as StayType;
  else if (kind !== 'match') s.type = 'hotel';
  if (b.checkIn) {
    s.checkIn = b.checkIn;
    s.nights = b.checkOut ? Math.max(1, daysBetween(b.checkIn, b.checkOut)) : s.nights;
    s.checkOut = addDay(s.checkIn, s.nights);
  }
  const town = b.town ?? (b.address ? townOf(b.address) : undefined);
  if (town && (rename || !s.location)) s.location = town;
  s.booking = { ...s.booking, source: 'booking', ...(b.confirmation ? { confirmationCode: b.confirmation } : {}) };
  delete s.assumed;
  delete s.nameIsPlaceholder;
  s.privateNotes = [...s.privateNotes.filter((l) => !BOOKING_NOTE.test(l)), ...bookingNotes(b)];
  if (kind !== 'match') delete s.point; // a new place needs its own pin
  return s;
}
