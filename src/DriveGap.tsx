// A one-tap "add a drive" between two neighbours in a day: between two entries, or between the last entry and where
// the night is spent. The start and end are taken from the places on either side, and the road is looked up at once.
import { useState } from 'react';
import type { CommuteEntry, Day, Entry, Leg, Point, Stay, Trip } from './model.ts';
import { Icon } from './Icon.tsx';
import { routeRoad } from './roads.ts';
import type { Tracks } from './MapView.tsx';
import type { SheetState } from './Edit.tsx';

interface End {
  name: string;
  point?: Point;
}

const short = (s: string) => s.split(/[,·:]| - /)[0].trim() || s;
const flat = (a: Point, b: Point) => Math.hypot((b.lon - a.lon) * 111.32 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)), (b.lat - a.lat) * 110.57);

/** Where an entry finishes: the end of its trail, the end of its last leg, or the place it happens. */
function endOf(e: Entry, tracks: Tracks): End {
  if (e.kind === 'commute') {
    const l = e.legs[e.legs.length - 1];
    return { name: l?.to ?? e.title, point: l?.toPoint };
  }
  const t = tracks[e.id];
  if (t?.lines.length) {
    const line = t.lines[t.lines.length - 1];
    const [lon, lat] = line[line.length - 1];
    return { name: e.title, point: { lon, lat } };
  }
  return { name: e.title, point: e.at };
}

/** Where an entry starts. */
function startOf(e: Entry, tracks: Tracks): End {
  if (e.kind === 'commute') {
    const l = e.legs[0];
    return { name: l?.from ?? e.title, point: l?.fromPoint };
  }
  const t = tracks[e.id];
  if (t?.lines.length && t.lines[0].length) return { name: e.title, point: { lon: t.lines[0][0][0], lat: t.lines[0][0][1] } };
  return { name: e.title, point: e.at };
}

export function DriveGap({ day, index, stay, tracks, mutate, openSheet }: { day: Day; index: number; stay?: Stay; tracks: Tracks; mutate: (fn: (t: Trip) => void) => Promise<void>; openSheet: (s: SheetState) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const here = day.entries[index];
  const next = day.entries[index + 1];
  const from = endOf(here, tracks);
  const to: End | undefined = next ? startOf(next, tracks) : stay ? { name: stay.name, point: stay.point ?? day.point } : undefined;
  if (!to) return null;
  // two neighbours already in the same spot have nothing between them to drive
  if (from.point && to.point && flat(from.point, to.point) < 0.3) return null;

  const add = async () => {
    setBusy(true);
    setNote('');
    const id = `${day.date}-d${Math.random().toString(36).slice(2, 7)}`;
    const leg: Leg = { mode: 'drive', from: short(from.name), to: short(to.name), ...(from.point ? { fromPoint: from.point } : {}), ...(to.point ? { toPoint: to.point } : {}) };
    if (from.point && to.point) {
      try {
        const r = await routeRoad([from.point, to.point]);
        leg.path = r.path;
        leg.distanceKm = r.km;
        leg.durationMin = r.min;
      } catch (e) {
        // saved without the road; it is looked up again the next time the trip opens
        setNote(e instanceof Error ? `${e.message} The drive was added as a straight line for now.` : 'The drive was added without its road.');
      }
    }
    const entry: CommuteEntry = { id, kind: 'commute', between: true, title: `Drive ${leg.from} to ${leg.to}`, notes: [], warnings: [], links: [], legs: [leg] };
    try {
      await mutate((t) => {
        const d = t.days.find((q) => q.date === day.date)!;
        const at = d.entries.findIndex((e) => e.id === here.id);
        d.entries.splice(at < 0 ? d.entries.length : at + 1, 0, entry);
      });
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!(from.point && to.point)) openSheet({ type: 'entry', date: day.date, id, kind: 'commute' });
  };

  return (
    <div className="drive-gap">
      <button type="button" disabled={busy} onClick={() => void add()} aria-label={`Add a drive from ${short(from.name)} to ${short(to.name)}`}>
        <Icon name="bus" size={16} />
        <span>
          {busy ? 'Finding the road…' : `Drive to ${short(to.name)}`}
          {!busy && !(from.point && to.point) ? ' · pick the places' : ''}
        </span>
      </button>
      {note && <p role="status" className="hint">{note}</p>}
    </div>
  );
}
