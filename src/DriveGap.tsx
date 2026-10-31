// A one-tap "getting there" between two neighbours in a day (two entries, or the last entry and where the night is spent):
// a drive, bus, taxi, ferry or flight. The start and end come from the places on either side, and the road, ferry line or
// flight distance is filled in at once.
import { useState } from 'react';
import type { CommuteEntry, Day, Entry, Leg, Point, Stay, TransportMode, Trip } from './model.ts';
import { Icon, modeIcon } from './Icon.tsx';
import { routeRoad } from './roads.ts';
import { routeFerry } from './ferry.ts';
import type { Tracks } from './MapView.tsx';
import type { SheetState } from './Edit.tsx';

interface End {
  name: string;
  point?: Point;
}

const MODES: { mode: TransportMode; label: string }[] = [
  { mode: 'drive', label: 'Drive' },
  { mode: 'bus', label: 'Bus' },
  { mode: 'taxi', label: 'Taxi' },
  { mode: 'ferry', label: 'Ferry' },
  { mode: 'flight', label: 'Flight' },
];
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
  const [busy, setBusy] = useState<TransportMode | ''>('');
  const [note, setNote] = useState('');
  const here = day.entries[index];
  const next = day.entries[index + 1];
  const from = endOf(here, tracks);
  const to: End | undefined = next ? startOf(next, tracks) : stay ? { name: stay.name, point: stay.point ?? day.point } : undefined;
  if (!to) return null;
  // two neighbours already in the same spot have nothing between them to drive
  if (from.point && to.point && flat(from.point, to.point) < 0.3) return null;

  const add = async (mode: TransportMode, label: string) => {
    setBusy(mode);
    setNote('');
    const id = `${day.date}-d${Math.random().toString(36).slice(2, 7)}`;
    const leg: Leg = { mode, from: short(from.name), to: short(to.name), ...(from.point ? { fromPoint: from.point } : {}), ...(to.point ? { toPoint: to.point } : {}) };
    if (from.point && to.point) {
      const km = Math.round(flat(from.point, to.point) * 10) / 10;
      try {
        if (mode === 'ferry') {
          const f = await routeFerry(from.point, to.point);
          if (f) Object.assign(leg, { path: f.path, distanceKm: f.km, durationMin: f.min });
          else Object.assign(leg, { pathTried: true, distanceKm: km, durationMin: Math.round((km / 26) * 60) });
        } else if (mode === 'flight') {
          Object.assign(leg, { distanceKm: km, durationMin: Math.round((km / 780) * 60 + 50) });
        } else {
          const r = await routeRoad([from.point, to.point]);
          Object.assign(leg, { path: r.path, distanceKm: r.km, durationMin: r.min });
        }
      } catch (e) {
        // saved without the road; it is looked up again the next time the trip opens
        setNote(e instanceof Error ? `${e.message} Added as a straight line for now.` : 'Added without its road.');
      }
    }
    const entry: CommuteEntry = { id, kind: 'commute', between: true, title: `${label} ${leg.from} to ${leg.to}`, notes: [], warnings: [], links: [], legs: [leg] };
    try {
      await mutate((t) => {
        const d = t.days.find((q) => q.date === day.date)!;
        const at = d.entries.findIndex((e) => e.id === here.id);
        d.entries.splice(at < 0 ? d.entries.length : at + 1, 0, entry);
      });
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not save.');
      setBusy('');
      return;
    }
    setBusy('');
    if (!(from.point && to.point)) openSheet({ type: 'entry', date: day.date, id, kind: 'commute' });
  };

  return (
    <div className="drive-gap" role="group" aria-label={`Add getting to ${short(to.name)}`}>
      <span className="gap-to">Getting to {short(to.name)}{from.point && to.point ? '' : ' · pick the places next'}</span>
      <div className="gap-modes">
        {MODES.map((m) => (
          <button key={m.mode} type="button" disabled={!!busy} onClick={() => void add(m.mode, m.label)} aria-label={`${m.label} from ${short(from.name)} to ${short(to.name)}`}>
            <Icon name={modeIcon(m.mode)} size={15} /> {busy === m.mode ? 'Finding…' : m.label}
          </button>
        ))}
      </div>
      {note && <p role="status" className="hint">{note}</p>}
    </div>
  );
}
