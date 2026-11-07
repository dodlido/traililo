// Brings a trip saved by an older (or damaged) version of the app up to the shape the screens expect.
// Every place a trip is read from (the database, the copy kept on the phone, an unsent change) goes through here,
// so a screen never has to guess whether a list exists. Raise SCHEMA and add a step when the shape of a trip changes.
import type { StayType, Trip } from './model.ts';

export const SCHEMA = 1;

const OLD_STAY_TYPES: Record<string, StayType> = { lodge: 'hotel', refugio: 'camp' };

export function migrate(input: Trip): Trip {
  const t = input as Trip & { schemaVersion?: number };
  if (t.schemaVersion === SCHEMA && Array.isArray(t.days) && t.days.length > 0 && Array.isArray(t.stays)) return t;
  const days = (Array.isArray(t.days) ? t.days : []).map((d) => ({
    ...d,
    entries: Array.isArray(d.entries) ? d.entries : [],
    todos: Array.isArray(d.todos) ? d.todos : [],
  }));
  // every screen counts on there being a first day; a trip with none gets one on its start date
  if (!days.length && /^\d{4}-\d{2}-\d{2}$/.test(t.startDate ?? '')) days.push({ date: t.startDate, region: 'Day 1', entries: [], todos: [] } as (typeof days)[number]);
  const stays = (Array.isArray(t.stays) ? t.stays : []).map((s) => ({
    ...s,
    type: OLD_STAY_TYPES[s.type as string] ?? s.type, // lodges and refugios were folded into hotels and camps
    notes: Array.isArray(s.notes) ? s.notes : [],
    privateNotes: Array.isArray(s.privateNotes) ? s.privateNotes : [],
  }));
  return { ...t, days, stays, schemaVersion: SCHEMA } as Trip;
}
