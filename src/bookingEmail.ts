// Reads the text of a Booking.com confirmation email (pasted in) into the fields of a stay.
// It works on labels ("Check-in", "Confirmation number", "PIN code") and is forgiving about layout, so a copy from a
// phone (label and value on separate lines) and a copy from a computer (label: value) both work.
// English wording only. Whatever it cannot find is simply left out, and the person checks the rest before saving.

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
  const w = text.slice(from, from + 70).split(/check[\s-]?(?:in|out)/i)[0];
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
    text.match(/(?:confirmation|booking|reservation)\s*(?:number|no\.?|#|code|id)\s*[:#]?\s*(\d[\d. ]{6,16}\d)/i)?.[1] ??
    text.match(/\bconfirmation\s*[:#]\s*(\d[\d. ]{6,16}\d)/i)?.[1] ??
    text.match(/\((\d{8,12})\)/)?.[1];
  const digits = conf?.replace(/\D/g, '');
  if (digits && digits.length >= 8 && digits.length <= 12) out.confirmation = digits;
  const pin = text.match(/\bPIN(?:\s*code)?\s*[:#]?\s*(\d{4})\b/i)?.[1];
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
  let inD = after(/check[\s-]?in/gi) ?? after(/\barrival\b/gi);
  let outD = after(/check[\s-]?out/gi) ?? after(/\bdeparture\b/gi);
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
  const phone = text.match(/(?:phone|tel(?:ephone)?)(?:\s*number)?\s*[:#]?\s*(\+?\d[\d ().-]{6,20}\d)/i)?.[1];
  if (phone) out.phone = phone.trim();

  // address: a labelled line, otherwise the first line that looks like "street, town, country"
  let addrIdx = -1;
  const labelled = lines.findIndex((l, i) => {
    const m = l.match(/^(?:address|location)\b\s*:?\s*(.*)$/i);
    return !!m && (m[1] || lines[i + 1] || '').includes(',');
  });
  if (labelled >= 0) {
    const rest = lines[labelled].replace(/^(?:address|location)\b\s*:?\s*/i, '');
    if (rest.length > 5) {
      out.address = rest;
      addrIdx = labelled;
    } else {
      out.address = lines[labelled + 1];
      addrIdx = labelled + 1;
    }
  }
  if (!out.address) {
    addrIdx = lines.findIndex(looksLikeAddress);
    if (addrIdx >= 0) out.address = lines[addrIdx];
  }
  if (out.address) out.address = out.address.replace(/\s*(?:show (?:on )?map|view (?:on )?map|get directions)\s*$/i, '').trim();

  // town and free-cancellation deadline
  const town = text.match(/\byour \w+ in ([^\n.!]+?) is confirmed/i)?.[1];
  if (town) out.town = town.trim();
  const cancel = text.match(/cancel for free until\s+([^\n\[]*?\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1];
  if (cancel) out.cancelUntil = cancel.replace(/\s+/g, ' ').trim();

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
  const t = parts[1].replace(/\b[A-Z]{0,2}[- ]?\d[\d-]*\b/g, '').replace(/\s+/g, ' ').trim();
  return t.length >= 2 ? t : undefined;
}

/** The stay type that fits a name, when the name says so. Hotels are the default, so they return nothing. */
export function guessType(name: string): 'lodge' | 'refugio' | 'camp' | 'glamping' | undefined {
  if (/refugio/i.test(name)) return 'refugio';
  if (/glamping|domo|dome/i.test(name)) return 'glamping';
  if (/camp(?:ing|site|ground)?\b/i.test(name)) return 'camp';
  if (/lodge|cabin|cabaña|cabana|posada|hosteria|hostería/i.test(name)) return 'lodge';
  return undefined;
}
