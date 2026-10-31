// Editing, for the trip's owner. Everything opens as a bottom sheet; "Save" writes to the database straight away.
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CommuteEntry, Day, Entry, ExperienceEntry, HikeEntry, Leg, Link, MealEntry, Point, Stay, StayType, Trip, TransportMode } from './model.ts';
import { findStayPin, nameSpot, parseCoords, searchPlace, type Found } from './geocode.ts';
import { BOOKING_NOTE, bookingNotes, daysBetween, guessType, parseBookingEmail, townOf } from './bookingEmail.ts';
import { MapPick, PlanCtx, RouteMini, planAnchor, planLines, planPlaces } from './Pick.tsx';
import { routeRoad } from './roads.ts';
import { routeFerry } from './ferry.ts';
import { parseGpx, type ParsedTrack } from './gpx.ts';
import type { Tracks } from './MapView.tsx';
import { Icon } from './Icon.tsx';
import { legTimes, minutes } from './derive.ts';

/** A spot picked on the map, to start something from. */
export interface Start { name: string; point: Point }

export type SheetState =
  | { type: 'add'; date: string; start?: Start }
  | { type: 'entry'; date: string; id?: string; kind?: Entry['kind']; start?: Start }
  | { type: 'stay'; id?: string; date?: string; start?: Start }
  | { type: 'day'; date: string }
  | { type: 'journal'; date: string }
  | { type: 'line'; date: string; id?: string; start?: Start }
  | { type: 'settings' }
  | { type: 'bookings' };

type Mutate = (fn: (t: Trip) => void) => Promise<void>;
const rid = () => Math.random().toString(36).slice(2, 7);
const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);
const num = (v: string): number | undefined => (v.trim() === '' || Number.isNaN(+v) ? undefined : +v);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet-panel">
        <header>
          <h2>{title}</h2>
          <button type="button" className="round" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Actions({ onSave, busy, error, onDelete, deleteLabel = 'Delete' }: { onSave: () => void; busy: boolean; error: string | null; onDelete?: () => void; deleteLabel?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="sheet-actions">
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="button" className="auth-primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button>
      {onDelete && (
        <button type="button" className={armed ? 'danger armed' : 'danger'} onClick={() => (armed ? onDelete() : setArmed(true))}>
          {armed ? 'Tap again to delete' : deleteLabel}
        </button>
      )}
    </div>
  );
}

export function useSave(mutate: Mutate, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: (t: Trip) => void) => {
    setBusy(true);
    setError(null);
    try {
      await mutate(fn);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(false);
  };
  return { busy, error, run };
}

export function PlaceSearch({ onPick, current, onClear, near, keepOpen, always }: { onPick: (name: string, p: Point) => void; current?: Point; onClear: () => void; near?: Point; keepOpen?: boolean; always?: boolean }) {
  const ctx = useContext(PlanCtx);
  const plan = useMemo(() => (ctx ? planPlaces(ctx.trip, ctx.tracks) : undefined), [ctx]);
  const lines = useMemo(() => (ctx ? planLines(ctx.trip, ctx.tracks) : undefined), [ctx]);
  const anchor = ctx ? planAnchor(ctx.trip, ctx.date) : undefined;
  const [seen, setSeen] = useState(false);
  const [q, setQ] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [res, setRes] = useState<Found[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    const c = parseCoords(q);
    if (c) {
      if ('hint' in c) setErr(c.hint);
      else {
        const name = c.name ?? (await nameSpot(c.point));
        onPick(name, c.point);
        setRes(null);
        setQ('');
      }
      setBusy(false);
      return;
    }
    try {
      setRes(await searchPlace(q.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Search failed');
    }
    setBusy(false);
  };
  return (
    <div className="place-search">
      <div className="row">
        <input
          placeholder="Search a place, or paste coordinates or a map link"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setSeen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go();
            }
          }}
        />
        <button type="button" className="chip" onClick={go} disabled={busy}>{busy ? '…' : 'Find'}</button>
        <button type="button" className={mapOpen ? 'chip is-on' : 'chip'} aria-pressed={mapOpen} onClick={() => setMapOpen(!mapOpen)}>Map</button>
      </div>
      {(mapOpen || (plan && (always || seen || (res && res.length > 0)))) && (
        <MapPick
          near={near}
          current={current}
          anchor={anchor}
          plan={plan}
          lines={lines}
          results={res ?? undefined}
          onPick={(n, p) => {
            onPick(n, p);
            if (!keepOpen && mapOpen) setMapOpen(false);
            if (!mapOpen) setRes(null);
          }}
        />
      )}
      {current && (
        <p className="small">
          Pinned at {current.lat.toFixed(3)}, {current.lon.toFixed(3)}{' '}
          <button type="button" className="auth-link inline" onClick={onClear}>remove</button>
        </p>
      )}
      {err && <p className="auth-error">{err}</p>}
      {res && res.length === 0 && <p className="small">Nothing found. Try a different spelling.</p>}
      {res && res.length > 0 && (
        <ul className="found">
          {res.map((r) => (
            <li key={r.name}>
              <button
                type="button"
                onClick={() => {
                  onPick(r.name, { ...r.point, approx: true });
                  setRes(null);
                  setQ('');
                }}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- add menu

export function AddMenu({ date, start, open, onClose }: { date: string; start?: Start; open: (s: SheetState) => void; onClose: () => void }) {
  const items: { kind: Entry['kind']; label: string; icon: string }[] = [
    { kind: 'hike', label: 'Hike', icon: 'hike' },
    { kind: 'experience', label: 'Activity', icon: 'spark' },
    { kind: 'meal', label: 'Restaurant', icon: 'fork' },
    { kind: 'hang', label: 'Night out', icon: 'cocktail' },
    { kind: 'commute', label: 'Getting there', icon: 'bus' },
    { kind: 'note', label: 'Note', icon: 'note' },
  ];
  return (
    <Sheet title={start ? 'Add here' : 'Add to this day'} onClose={onClose}>
      {start && <p className="small start-note">Starting at <b>{start.name}</b></p>}
      <div className="add-grid">
        {items.map((i) => (
          <button key={i.kind} type="button" onClick={() => open({ type: 'entry', date, kind: i.kind, start })}>
            <Icon name={i.icon} size={26} />
            <span>{i.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => open({ type: 'line', date, start })}>
          <Icon name="map" size={26} />
          <span>Route on map</span>
        </button>
        <button type="button" onClick={() => open({ type: 'stay', date, start })}>
          <Icon name="bed" size={26} />
          <span>Place to sleep</span>
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- entries

const MODES: TransportMode[] = ['flight', 'bus', 'drive', 'ferry', 'taxi'];

export type SetTrack = (id: string, track: Tracks[string] | null, gain?: number, mode?: 'file' | 'fill') => Promise<void>;

const fromUrl = (u: string) => {
  try {
    const last = new URL(u).pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last).replace(/-t\d+$/, '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()).trim();
  } catch {
    return '';
  }
};
const goodUrl = (u: string, host: RegExp) => {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && host.test(x.hostname);
  } catch {
    return false;
  }
};
const flat = (a: Point, b: Point) => Math.hypot((b.lon - a.lon) * 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), (b.lat - a.lat) * 110.57);

export function EntryEditor({ trip, mutate, setTrack, date, id, kind, start, onClose }: { trip: Trip; mutate: Mutate; setTrack: SetTrack; date: string; id?: string; kind?: Entry['kind']; start?: Start; onClose: () => void }) {
  const existing = useMemo(() => (id ? trip.days.find((d) => d.date === date)?.entries.find((e) => e.id === id) : undefined), [trip, date, id]);
  const base: Entry = useMemo(
    () =>
      existing
        ? structuredClone(existing)
        : ({ id: `${date}-n${rid()}`, kind: kind ?? 'note', title: '', notes: [], warnings: [], links: [], ...(kind === 'commute' ? { legs: [{ mode: 'drive', ...(start ? { from: start.name, fromPoint: start.point } : {}) }] } : start ? { at: start.point } : {}) } as Entry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [d, setD] = useState<Entry>(base);
  const [notes, setNotes] = useState((base.notes ?? []).join('\n'));
  const [priv, setPriv] = useState((base.privateNotes ?? []).join('\n'));
  const [warn, setWarn] = useState((base.warnings ?? []).join('\n'));
  const [links, setLinks] = useState<Link[]>(base.links ?? []);
  const [day, setDay] = useState(date);
  const [err, setErr] = useState<string | null>(null);
  const { busy, error, run } = useSave(mutate, onClose);
  const [own, setOwn] = useState(false);
  const [hmode, setHmode] = useState<'link' | 'manual'>(start && !existing && kind === 'hike' ? 'manual' : 'link');
  const [gpx, setGpx] = useState<ParsedTrack | null>(null);
  const [gpxErr, setGpxErr] = useState('');
  const [alltrails, setAlltrails] = useState('');
  const [gyg, setGyg] = useState('');
  const [wps, setWps] = useState<{ name: string; point: Point }[]>((base as HikeEntry).waypoints ?? (start && !existing && kind === 'hike' ? [{ name: start.name.split(',')[0].trim(), point: start.point }] : []));
  const [routing, setRouting] = useState<number | null>(null);
  const [roadErr, setRoadErr] = useState('');
  const up = (patch: Record<string, unknown>) => setD((p) => ({ ...p, ...patch }) as Entry);
  const h = d as HikeEntry;
  const x = d as ExperienceEntry;
  const m = d as MealEntry;
  const c = d as CommuteEntry;
  const dur = h.durationMin;
  const setDur = (hh: string, mm: string) => {
    const total = (num(hh) ?? 0) * 60 + (num(mm) ?? 0);
    up({ durationMin: hh === '' && mm === '' ? undefined : total });
  };
  const isNew = !existing;
  const dayEntries = trip.days.find((dd) => dd.date === date)?.entries ?? [];
  const pos = dayEntries.findIndex((e) => e.id === id);

  const quick = d.kind === 'hike' && isNew && hmode === 'link';
  const driveLegs = d.kind === 'commute' ? (c.legs ?? []).filter((l) => l.mode === 'drive') : [];
  const ROAD: TransportMode[] = ['drive', 'bus', 'taxi'];
  const patchLeg = (i: number, patch: Partial<Leg>) => setD((p) => ({ ...p, legs: (p as CommuteEntry).legs.map((q, j) => (j === i ? { ...q, ...patch } : q)) }) as Entry);
  // with a start and an end, everything else follows: the road for road trips, the straight distance and a rough time otherwise
  const fill = async (i: number, leg: Leg) => {
    if (!(leg.fromPoint && leg.toPoint)) return;
    setRouting(i);
    setRoadErr('');
    try {
      if (ROAD.includes(leg.mode)) {
        const r = await routeRoad([leg.fromPoint, leg.toPoint]);
        patchLeg(i, { path: r.path, distanceKm: r.km, durationMin: r.min });
      } else if (leg.mode === 'ferry') {
        // follow a charted ferry line when there is one, so the route stays on the water
        const f = await routeFerry(leg.fromPoint, leg.toPoint);
        if (f) patchLeg(i, { path: f.path, distanceKm: f.km, durationMin: f.min, pathTried: undefined });
        else {
          const km = Math.round(flat(leg.fromPoint, leg.toPoint) * 10) / 10;
          patchLeg(i, { path: undefined, pathTried: true, distanceKm: km, durationMin: Math.round((km / 26) * 60) });
        }
      } else {
        const km = Math.round(flat(leg.fromPoint, leg.toPoint) * 10) / 10;
        const min = leg.mode === 'flight' ? Math.round((km / 780) * 60 + 50) : undefined;
        patchLeg(i, { path: undefined, distanceKm: km, durationMin: min });
      }
    } catch (e) {
      setRoadErr(e instanceof Error ? e.message : 'Could not find the road');
    }
    setRouting(null);
  };
  const pickLeg = async (i: number, side: 'from' | 'to', name: string, pt: Point) => {
    const next = { ...c.legs[i], [side]: name.split(',')[0].trim(), [side === 'from' ? 'fromPoint' : 'toPoint']: pt, path: undefined } as Leg;
    patchLeg(i, next);
    await fill(i, next);
  };
  const setMode = async (i: number, mode: TransportMode) => {
    const next = { ...c.legs[i], mode, path: undefined } as Leg;
    patchLeg(i, next);
    await fill(i, next);
  };
  const loadGpx = async (f: File | undefined) => {
    if (!f) return;
    setGpxErr('');
    try {
      setGpx(parseGpx(await f.text(), f.name.replace(/\.gpx$/i, '')));
    } catch (e) {
      setGpx(null);
      setGpxErr(e instanceof Error ? e.message : 'Could not read that file');
    }
  };
  const moveWp = (i: number, dir: -1 | 1) => setWps((w) => { const n = [...w]; const j = i + dir; if (j < 0 || j >= n.length) return w; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const wpKm = wps.reduce((n, w, i) => (i ? n + flat(wps[i - 1].point, w.point) : 0), 0);

  const save = async () => {
    setErr(null);
    if (quick) {
      const at = alltrails.trim();
      const gg = gyg.trim();
      if (!gpx && !at && !gg) return setErr('Add a GPX file, an AllTrails link or a GetYourGuide link.');
      if (at && !goodUrl(at, /(^|\.)alltrails\.com$/i)) return setErr('That does not look like an AllTrails link.');
      if (gg && !goodUrl(gg, /(^|\.)getyourguide\.[a-z.]+$/i)) return setErr('That does not look like a GetYourGuide link.');
      const first = gpx?.lines[0]?.[0];
      const out = {
        ...d,
        title: gpx?.name || fromUrl(at) || fromUrl(gg) || (at ? 'AllTrails hike' : 'Guided hike'),
        notes: lines(notes),
        links: [...(at ? [{ type: 'alltrails' as const, label: 'AllTrails', url: at }] : []), ...(gg ? [{ type: 'getyourguide' as const, label: 'GetYourGuide', url: gg }] : [])],
        guided: gg ? true : undefined,
        distanceKm: gpx?.km,
        elevationGainM: gpx?.gain,
        at: first ? { lon: first[0], lat: first[1] } : undefined,
      } as Entry;
      setOwn(true);
      try {
        await mutate((t) => { t.days.find((dd) => dd.date === date)!.entries.push(out); });
        if (gpx) await setTrack(out.id, { lines: gpx.lines, km: gpx.km, name: gpx.name }, gpx.gain, 'file');
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.');
      }
      setOwn(false);
      return;
    }
    if (!d.title.trim() && d.kind !== 'commute') return setErr('Give it a name first.');
    if (d.kind === 'commute') {
      for (const l of c.legs ?? []) if ((isNew || l.fromPoint || l.toPoint) && (!(l.fromPoint && l.toPoint) || (ROAD.includes(l.mode) && !l.path))) return setErr('Pick a start and an end for each leg' + (c.legs.some((q) => ROAD.includes(q.mode)) ? ', so the road can be found.' : '.'));
    }
    const hadWps = ((existing as HikeEntry | undefined)?.waypoints?.length ?? 0) > 0;
    const track = d.kind === 'hike' && wps.length >= 2 ? { lines: [wps.map((w) => [w.point.lon, w.point.lat])], km: Math.round(wpKm * 10) / 10, name: d.title.trim() } : null;
    const out: Entry = {
      ...d,
      ...(d.kind === 'hike' ? { waypoints: wps.length ? wps : undefined, ...(wps.length && !d.at ? { at: wps[0].point } : {}), ...(track && h.distanceKm === undefined ? { distanceKm: track.km } : {}) } : {}),
      title: d.title.trim() || (c.legs?.[0] ? `${{ drive: 'Drive', bus: 'Bus', taxi: 'Taxi', ferry: 'Ferry', flight: 'Flight' }[c.legs[0].mode] ?? 'Trip'} ${c.legs[0].from ?? ''} to ${c.legs[0].to ?? ''}`.trim() : 'Getting there'),
      notes: lines(notes),
      warnings: lines(warn),
      privateNotes: lines(priv),
      links: links.filter((l) => l.label.trim() || l.url).map((l) => ({ ...l, label: l.label.trim() || l.url || 'Link', url: l.url?.trim() || undefined })),
    };
    const apply = (t: Trip) => {
      const from = t.days.find((dd) => dd.date === date)!;
      const to = t.days.find((dd) => dd.date === day)!;
      if (existing && date === day) from.entries = from.entries.map((e) => (e.id === out.id ? out : e));
      else {
        from.entries = from.entries.filter((e) => e.id !== out.id);
        to.entries.push(out);
      }
    };
    if (d.kind === 'hike' && (track || hadWps)) {
      setOwn(true);
      try {
        await mutate(apply);
        await setTrack(out.id, track, undefined, 'fill');
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save.');
      }
      setOwn(false);
    } else run(apply);
  };
  const remove = () =>
    run((t) => {
      const dd = t.days.find((q) => q.date === date)!;
      dd.entries = dd.entries.filter((e) => e.id !== id);
    });
  const move = (dir: -1 | 1) =>
    run((t) => {
      const dd = t.days.find((q) => q.date === date)!;
      const i = dd.entries.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= dd.entries.length) return;
      [dd.entries[i], dd.entries[j]] = [dd.entries[j], dd.entries[i]];
    });

  const kindLabel = { hike: 'hike', experience: 'activity', commute: 'travel', note: 'note', meal: 'restaurant', hang: 'night out' }[d.kind];
  return (
    <Sheet title={isNew ? `New ${kindLabel}` : `Edit ${kindLabel}`} onClose={onClose}>
      {d.kind === 'hike' && isNew && (
        <div className="seg-switch" role="radiogroup" aria-label="How to add this hike">
          <button type="button" role="radio" aria-checked={hmode === 'link'} className={hmode === 'link' ? 'chip is-on' : 'chip'} onClick={() => setHmode('link')}>From a link or file</button>
          <button type="button" role="radio" aria-checked={hmode === 'manual'} className={hmode === 'manual' ? 'chip is-on' : 'chip'} onClick={() => setHmode('manual')}>Enter it myself</button>
        </div>
      )}
      {quick && (
        <>
          <Field label="GPX file" hint="Exported from AllTrails, Komoot, Garmin or similar. Distance and climb come from the file.">
            <input type="file" accept=".gpx,application/gpx+xml,application/octet-stream,text/xml,application/xml" onChange={(e) => void loadGpx(e.target.files?.[0])} />
            {gpx && <p className="small">{gpx.name} · {gpx.km} km{gpx.gain !== undefined ? ` · +${gpx.gain} m` : ''}</p>}
            {gpxErr && <p className="auth-error">{gpxErr}</p>}
          </Field>
          <Field label="AllTrails link" hint="Optional. Kept as a link for now.">
            <input inputMode="url" placeholder="https://www.alltrails.com/trail/…" value={alltrails} onChange={(e) => setAlltrails(e.target.value)} />
          </Field>
          <Field label="GetYourGuide link" hint="Optional, for a guided hike. Kept as a link for now.">
            <input inputMode="url" placeholder="https://www.getyourguide.com/…" value={gyg} onChange={(e) => setGyg(e.target.value)} />
          </Field>
          <Field label="Notes" hint="One per line. Friends see these."><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Actions onSave={save} busy={busy || own} error={err ?? error} />
        </>
      )}
      {!quick && (
      <>
      <Field label={d.kind === 'commute' ? 'Title (optional)' : d.kind === 'meal' ? 'Restaurant' : d.kind === 'hang' ? 'Place or show' : 'Name'}>
        <input value={d.title} onChange={(e) => up({ title: e.target.value })} autoFocus={isNew} />
      </Field>

      {d.kind === 'hike' && (
        <>
          <Field label="Points on the trail" hint="Search or tap the map to add points, then put them in walking order. They are drawn as a line on the map.">
            <ul className="wp-list">
              {wps.map((w, i) => (
                <li key={i}>
                  <b>{i + 1}</b>
                  <input value={w.name} aria-label={`Point ${i + 1} name`} onChange={(e) => setWps(wps.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)))} />
                  <button type="button" className="round small" aria-label="Move up" disabled={i === 0} onClick={() => moveWp(i, -1)}><Icon name="back" size={14} /></button>
                  <button type="button" className="round small" aria-label="Move down" disabled={i === wps.length - 1} onClick={() => moveWp(i, 1)}><Icon name="next" size={14} /></button>
                  <button type="button" className="round small" aria-label="Remove point" onClick={() => setWps(wps.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
                </li>
              ))}
            </ul>
            {wps.length >= 2 && <p className="small">{wps.length} points · about {Math.round(wpKm * 10) / 10} km in straight lines</p>}
            <PlaceSearch keepOpen near={wps[wps.length - 1]?.point} onClear={() => {}} onPick={(name, p) => setWps((w) => [...w, { name: name.split(',')[0].trim(), point: p }])} />
          </Field>
          <div className="two">
            <Field label="Starts"><input type="time" value={h.startTime ?? ''} onChange={(e) => up({ startTime: e.target.value || undefined })} /></Field>
            <Field label="Ends"><input type="time" value={h.endTime ?? ''} onChange={(e) => up({ endTime: e.target.value || undefined })} /></Field>
          </div>
          <div className="two">
            <Field label="Distance (km)"><input type="number" step="0.1" inputMode="decimal" value={h.distanceKm ?? ''} onChange={(e) => up({ distanceKm: num(e.target.value) })} /></Field>
            <Field label="Climb (m)"><input type="number" inputMode="numeric" value={h.elevationGainM ?? ''} onChange={(e) => up({ elevationGainM: num(e.target.value) })} /></Field>
          </div>
          <div className="two">
            <Field label="Hours"><input type="number" inputMode="numeric" value={dur === undefined ? '' : Math.floor(dur / 60)} onChange={(e) => setDur(e.target.value, String((dur ?? 0) % 60))} /></Field>
            <Field label="Minutes"><input type="number" inputMode="numeric" value={dur === undefined ? '' : dur % 60} onChange={(e) => setDur(String(Math.floor((dur ?? 0) / 60)), e.target.value)} /></Field>
          </div>
          <div className="two">
            <Field label="Difficulty">
              <select value={h.difficulty ?? ''} onChange={(e) => up({ difficulty: (e.target.value || undefined) as HikeEntry['difficulty'] })}>
                <option value="">—</option><option value="easy">Easy</option><option value="moderate">Moderate</option><option value="moderate-hard">Moderate to hard</option><option value="hard">Hard</option>
              </select>
            </Field>
            <Field label="Shape">
              <select value={h.shape ?? ''} onChange={(e) => up({ shape: (e.target.value || undefined) as HikeEntry['shape'] })}>
                <option value="">—</option><option value="out-and-back">Out and back</option><option value="loop">Loop</option><option value="circuit">Circuit</option><option value="one-way">One way</option>
              </select>
            </Field>
          </div>
          <label className="check"><input type="checkbox" checked={!!h.guided} onChange={(e) => up({ guided: e.target.checked })} /> Guided</label>
        </>
      )}

      {d.kind === 'experience' && (
        <>
          <div className="two">
            <Field label="Starts"><input type="time" value={x.startTime ?? ''} onChange={(e) => up({ startTime: e.target.value || undefined })} /></Field>
            <Field label="Ends"><input type="time" value={x.endTime ?? ''} onChange={(e) => up({ endTime: e.target.value || undefined })} /></Field>
          </div>
          <div className="two">
            <Field label="Hours"><input type="number" inputMode="numeric" value={dur === undefined ? '' : Math.floor(dur / 60)} onChange={(e) => setDur(e.target.value, String((dur ?? 0) % 60))} /></Field>
            <Field label="Minutes"><input type="number" inputMode="numeric" value={dur === undefined ? '' : dur % 60} onChange={(e) => setDur(String(Math.floor((dur ?? 0) / 60)), e.target.value)} /></Field>
          </div>
        </>
      )}

      {(d.kind === 'meal' || d.kind === 'hang') && (
        <div className="two">
          <Field label="Time"><input type="time" value={m.time ?? ''} onChange={(e) => up({ time: e.target.value || undefined })} /></Field>
          <Field label="People"><input type="number" min={1} inputMode="numeric" value={m.partySize ?? ''} onChange={(e) => up({ partySize: num(e.target.value) })} /></Field>
        </div>
      )}

      {d.kind === 'commute' && (
        <div className="legs-edit">
          <h3>Legs</h3>
          {(c.legs ?? []).map((l: Leg, i: number) => {
            const road = ROAD.includes(l.mode);
            return (
              <div className="drive-leg" key={i}>
                <div className="leg-row">
                  <select value={l.mode} aria-label="How" onChange={(e) => void setMode(i, e.target.value as TransportMode)}>
                    {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button type="button" className="round small" aria-label="Remove leg" onClick={() => up({ legs: c.legs.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
                </div>
                <Field label="Start (required)">
                  {l.fromPoint && <p className="pinned">{l.from || 'Pinned spot'}</p>}
                  <PlaceSearch current={l.fromPoint} near={l.toPoint} onPick={(n, p) => void pickLeg(i, 'from', n, p)} onClear={() => patchLeg(i, { fromPoint: undefined, path: undefined })} />
                </Field>
                <Field label="End (required)">
                  {l.toPoint && <p className="pinned">{l.to || 'Pinned spot'}</p>}
                  <PlaceSearch current={l.toPoint} near={l.fromPoint} onPick={(n, p) => void pickLeg(i, 'to', n, p)} onClear={() => patchLeg(i, { toPoint: undefined, path: undefined })} />
                </Field>
                {road ? (
                  <Field label="Leaves at" hint={l.startTime && !l.durationMin ? 'The arrival time is worked out once the trip has a travel time.' : undefined}>
                    <input type="time" value={l.startTime ?? ''} onChange={(e) => patchLeg(i, { startTime: e.target.value || undefined })} />
                    {legTimes(l).end && <p className="road">Arrives about {legTimes(l).end}{legTimes(l).days > 0 ? ' the next day' : ''} (no traffic)</p>}
                  </Field>
                ) : (
                  <div className="two">
                    <Field label="Departs"><input type="time" value={l.startTime ?? ''} onChange={(e) => patchLeg(i, { startTime: e.target.value || undefined })} /></Field>
                    <Field label="Arrives"><input type="time" value={l.endTime ?? ''} onChange={(e) => patchLeg(i, { endTime: e.target.value || undefined })} /></Field>
                  </div>
                )}
                {routing === i && <p className="road">{road ? 'Finding the road…' : 'Working it out…'}</p>}
                {routing !== i && l.fromPoint && l.toPoint && (road ? l.path : true) && (
                  <p className="road">
                    {road ? 'By road' : l.mode === 'ferry' ? (l.path ? 'Along the ferry line' : 'No charted ferry line found, so a straight line') : 'In a straight line'}: {l.distanceKm} km{l.durationMin ? ` · ${minutes(l.durationMin)}` : ''}{road ? ' (no traffic)' : ''}
                  </p>
                )}
                {!road && l.fromPoint && l.toPoint && (
                  <Field label="Time in minutes" hint="A rough guess. Change it to the timetable if you know it.">
                    <input type="number" inputMode="numeric" value={l.durationMin ?? ''} onChange={(e) => patchLeg(i, { durationMin: num(e.target.value) })} />
                  </Field>
                )}
                {roadErr && routing !== i && road && !l.path && l.fromPoint && l.toPoint && <p className="auth-error">{roadErr}</p>}
              </div>
            );
          })}
          <RouteMini legs={c.legs ?? []} />
          <button type="button" className="chip" onClick={() => up({ legs: [...(c.legs ?? []), { mode: 'drive' }] })}>+ Add a leg</button>
        </div>
      )}

      <Field label="Notes" hint="One per line. Friends see these."><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Field label="Heads-up" hint="Things not to forget, like “book ahead”. One per line."><textarea rows={2} value={warn} onChange={(e) => setWarn(e.target.value)} /></Field>
      <Field label="Private notes" hint="Only you see these."><textarea rows={2} value={priv} onChange={(e) => setPriv(e.target.value)} /></Field>

      <div className="links-edit">
        <h3>Links</h3>
        {links.map((l, i) => (
          <div className="link-row" key={i}>
            <input placeholder="Label" value={l.label} onChange={(e) => setLinks(links.map((q, j) => (j === i ? { ...q, label: e.target.value } : q)))} />
            <input placeholder="https://…" inputMode="url" value={l.url ?? ''} onChange={(e) => setLinks(links.map((q, j) => (j === i ? { ...q, url: e.target.value } : q)))} />
            <button type="button" className="round small" aria-label="Remove link" onClick={() => setLinks(links.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
          </div>
        ))}
        <button type="button" className="chip" onClick={() => setLinks([...links, { type: 'other', label: '', url: '' }])}>+ Add a link</button>
      </div>

      <div className="booking-edit">
        <h3>Booking <small>(only you see this)</small></h3>
        <div className="two">
          <Field label="Booked by"><input value={d.booking?.bookedBy ?? ''} onChange={(e) => up({ booking: { source: 'unspecified', ...d.booking, bookedBy: e.target.value || undefined } })} /></Field>
          <Field label="Confirmation code"><input value={d.booking?.confirmationCode ?? ''} onChange={(e) => up({ booking: { source: 'unspecified', ...d.booking, confirmationCode: e.target.value || undefined } })} /></Field>
        </div>
      </div>

      <Field label="Where on the map">
        <PlaceSearch always current={d.at} onPick={(_, p) => up({ at: p })} onClear={() => up({ at: undefined })} />
      </Field>

      <label className="check"><input type="checkbox" checked={!!d.optional} onChange={(e) => up({ optional: e.target.checked })} /> Optional (only if there’s time)</label>

      {!isNew && (
        <Field label="Day">
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {trip.days.map((dd) => <option key={dd.date} value={dd.date}>{dd.date} · {dd.region}</option>)}
          </select>
        </Field>
      )}
      {!isNew && dayEntries.length > 1 && (
        <div className="row">
          <button type="button" className="chip" disabled={pos <= 0 || busy} onClick={() => move(-1)}>Move up</button>
          <button type="button" className="chip" disabled={pos >= dayEntries.length - 1 || busy} onClick={() => move(1)}>Move down</button>
        </div>
      )}
      <Actions onSave={save} busy={busy || own || routing !== null} error={err ?? error} onDelete={isNew ? undefined : remove} />
      </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- stays

export function StayEditor({ trip, mutate, id, date, start, onClose }: { trip: Trip; mutate: Mutate; id?: string; date?: string; start?: Start; onClose: () => void }) {
  const existing = id ? trip.stays.find((s) => s.id === id) : undefined;
  const base = useMemo<Stay>(
    () =>
      existing
        ? structuredClone(existing)
        : { id: `stay-${rid()}`, name: '', type: 'hotel', checkIn: date ?? trip.startDate, checkOut: addDays(date ?? trip.startDate, 1), nights: 1, notes: [], privateNotes: [], ...(start ? { point: start.point, location: start.name.split(',')[0].trim() } : {}) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [s, setS] = useState<Stay>(base);
  const [notes, setNotes] = useState(base.notes.join('\n'));
  const [priv, setPriv] = useState(base.privateNotes.join('\n'));
  const [err, setErr] = useState<string | null>(null);
  const { busy, error, run } = useSave(mutate, onClose);
  const up = (p: Partial<Stay>) => setS((q) => ({ ...q, ...p }));
  const [mail, setMail] = useState('');
  const [mailMsg, setMailMsg] = useState<string[] | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  /** Fills the form from a pasted Booking.com or Airbnb confirmation email. The form is the review: nothing is saved until Save. */
  const readMail = async () => {
    const r = parseBookingEmail(mail);
    if (!r.name && !r.confirmation && !r.checkIn && !r.address) return setMailMsg(['I could not find booking details in that text. Paste the whole email, from the top.']);
    const got: string[] = [];
    const notes: string[] = [...r.warnings];
    const patch: Partial<Stay> = {};
    if (r.name) {
      patch.name = r.name;
      const t = r.source === 'airbnb' ? 'airbnb' : guessType(r.name);
      if (t) patch.type = t;
      got.push('name');
    }
    if (r.checkIn) {
      if (trip.days.some((dd) => dd.date === r.checkIn)) {
        patch.checkIn = r.checkIn;
        if (r.checkOut) patch.nights = daysBetween(r.checkIn, r.checkOut);
        got.push('dates');
      } else notes.push(`The check-in date (${r.checkIn}) is outside this trip, so I left the dates alone.`);
    }
    const town = s.location ? undefined : r.town ?? (r.address ? townOf(r.address) : undefined);
    if (town) patch.location = town;
    if (r.confirmation) got.push('confirmation number');
    if (r.address) got.push('address');
    const mine = bookingNotes(r);
    setPriv((p) => [...lines(p).filter((l) => !BOOKING_NOTE.test(l)), ...mine].join('\n'));
    setS((q) => ({
      ...q,
      ...patch,
      assumed: undefined,
      booking: { ...q.booking, source: r.source ?? 'booking', ...(r.confirmation ? { confirmationCode: r.confirmation } : {}) },
    }));
    setMailMsg([`Filled in: ${got.join(', ') || 'nothing'}. Check it below before saving.`, ...notes]);
    if (r.point) {
      setS((q) => ({ ...q, point: r.point }));
      setMailMsg((m) => [...(m ?? []), r.point!.approx ? 'The map pin is only the area, because the exact spot is not given. Move it if you can.' : 'The pin comes from the email’s map link. Check it below.']);
    } else if (r.name || r.address) {
      setMailBusy(true);
      const pin = await findStayPin(r.name ?? '', r.address);
      setMailBusy(false);
      if (pin) {
        setS((q) => ({ ...q, point: pin.point }));
        setMailMsg((m) => [...(m ?? []), pin.exact ? 'Found it on the map. Check the pin below.' : 'Only the area was found on the map, so the pin is approximate. Move it if you can.'].filter(Boolean));
      } else setMailMsg((m) => [...(m ?? []), 'I could not find it on the map. Search for it below.']);
    }
  };
  const save = () => {
    if (!s.name.trim()) return setErr('Give the place a name.');
    setErr(null);
    const nights = Math.max(1, Math.round(s.nights || 1));
    const out: Stay = { ...s, name: s.name.trim(), nights, checkOut: addDays(s.checkIn, nights), notes: lines(notes), privateNotes: lines(priv), nameIsPlaceholder: undefined };
    run((t) => {
      t.stays = existing ? t.stays.map((q) => (q.id === out.id ? out : q)) : [...t.stays, out];
      for (const dd of t.days) if (dd.stayId === out.id) delete dd.stayId;
      for (let i = 0; i < nights; i++) {
        const dd = t.days.find((q) => q.date === addDays(out.checkIn, i));
        if (dd) {
          dd.stayId = out.id;
          if (!dd.point && out.point) dd.point = out.point;
        }
      }
    });
  };
  const remove = () =>
    run((t) => {
      t.stays = t.stays.filter((q) => q.id !== id);
      for (const dd of t.days) if (dd.stayId === id) delete dd.stayId;
    });
  const types: StayType[] = ['hotel', 'airbnb', 'camp', 'glamping', 'other'];
  return (
    <Sheet title={existing ? 'Edit place to sleep' : 'New place to sleep'} onClose={onClose}>
      <details className="import-mail" open={!existing && !s.name}>
        <summary>Fill in from a Booking.com or Airbnb confirmation email</summary>
        <p className="hint">Open the confirmation email, select everything, copy it, and paste it here. It is read on this device only and is not saved.</p>
        <textarea rows={4} value={mail} placeholder="Paste the email here" onChange={(e) => setMail(e.target.value)} />
        <button type="button" className="chip" disabled={!mail.trim() || mailBusy} onClick={readMail}>{mailBusy ? 'Looking on the map…' : 'Read the email'}</button>
        {mailMsg && <ul className="import-msg">{mailMsg.map((m) => <li key={m}>{m}</li>)}</ul>}
      </details>
      <Field label="Name"><input value={s.name} onChange={(e) => up({ name: e.target.value })} autoFocus={!existing} /></Field>
      <div className="two">
        <Field label="Type"><select value={s.type} onChange={(e) => up({ type: e.target.value as StayType })}>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Nights"><input type="number" min={1} inputMode="numeric" value={s.nights} onChange={(e) => up({ nights: +e.target.value })} /></Field>
      </div>
      <Field label="First night">
        <select value={s.checkIn} onChange={(e) => up({ checkIn: e.target.value })}>
          {trip.days.map((dd) => <option key={dd.date} value={dd.date}>{dd.date} · {dd.region}</option>)}
        </select>
      </Field>
      <Field label="Town or area (optional)"><input value={s.location ?? ''} onChange={(e) => up({ location: e.target.value || undefined })} /></Field>
      <label className="check"><input type="checkbox" checked={!!s.assumed} onChange={(e) => up({ assumed: e.target.checked || undefined })} /> Not booked yet</label>
      <div className="booking-edit">
        <h3>Booking <small>(only you see this)</small></h3>
        <div className="two">
          <Field label="Booked by"><input value={s.booking?.bookedBy ?? ''} onChange={(e) => up({ booking: { source: 'unspecified', ...s.booking, bookedBy: e.target.value || undefined } })} /></Field>
          <Field label="Confirmation code"><input value={s.booking?.confirmationCode ?? ''} onChange={(e) => up({ booking: { source: 'unspecified', ...s.booking, confirmationCode: e.target.value || undefined } })} /></Field>
        </div>
        <Field label="Booked on">
          <select value={s.booking?.source ?? 'unspecified'} onChange={(e) => up({ booking: { ...s.booking, source: e.target.value as 'airbnb' | 'getyourguide' | 'booking' | 'unspecified' } })}>
            <option value="unspecified">—</option><option value="airbnb">Airbnb</option><option value="booking">Booking.com</option><option value="getyourguide">GetYourGuide</option>
          </select>
        </Field>
      </div>
      <Field label="Notes" hint="One per line. Friends see these."><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Field label="Private (address, phone, door code)" hint="Only you see these."><textarea rows={3} value={priv} onChange={(e) => setPriv(e.target.value)} /></Field>
      <Field label="Where on the map"><PlaceSearch always current={s.point} onPick={(_, p) => up({ point: p })} onClear={() => up({ point: undefined })} /></Field>
      <Actions onSave={save} busy={busy} error={err ?? error} onDelete={existing ? remove : undefined} />
    </Sheet>
  );
}

// ---------------------------------------------------------------- day and trip settings

export function DayEditor({ trip, mutate, date, onClose }: { trip: Trip; mutate: Mutate; date: string; onClose: () => void }) {
  const day = trip.days.find((d) => d.date === date)!;
  const [region, setRegion] = useState(day.region);
  const [country, setCountry] = useState(day.country ?? '');
  const [point, setPoint] = useState<Point | undefined>(day.point);
  const [rest, setRest] = useState(false);
  const { busy, error, run } = useSave(mutate, onClose);
  const regions = [...new Set(trip.days.map((d) => d.region))];
  const save = () =>
    run((t) => {
      const targets = rest ? t.days.filter((d) => d.date >= date && d.region === day.region) : t.days.filter((d) => d.date === date);
      for (const d of targets) {
        d.region = region.trim() || d.region;
        d.country = country.trim().toUpperCase().slice(0, 2) || undefined;
        if (d.date === date) d.point = point;
      }
    });
  return (
    <Sheet title={`Day ${date}`} onClose={onClose}>
      <Field label="Place" hint="Days in the same place are grouped together on the Journey page.">
        <input list="region-list" value={region} onChange={(e) => setRegion(e.target.value)} />
        <datalist id="region-list">{regions.map((r) => <option key={r} value={r} />)}</datalist>
      </Field>
      <Field label="Country code" hint="Two letters, like AR, CL, PT, JP."><input maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
      <Field label="Where on the map"><PlaceSearch always current={point} onPick={(_, p) => setPoint(p)} onClear={() => setPoint(undefined)} /></Field>
      <label className="check"><input type="checkbox" checked={rest} onChange={(e) => setRest(e.target.checked)} /> Apply the place and country to the following days in “{day.region}” too</label>
      <Actions onSave={save} busy={busy} error={error} />
    </Sheet>
  );
}

export function SettingsEditor({ title, cover, themes, onSave, onClose }: { title: string; cover: string; themes: string[]; onSave: (title: string, cover: string) => Promise<void>; onClose: () => void }) {
  const [t, setT] = useState(title);
  const [c, setC] = useState(cover);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Trip settings" onClose={onClose}>
      <Field label="Trip name"><input value={t} onChange={(e) => setT(e.target.value)} /></Field>
      <Field label="Cover look" hint="Picks the colors and the drawing on the trip card."><select value={c} onChange={(e) => setC(e.target.value)}>{themes.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
      <Actions
        busy={busy}
        error={error}
        onSave={async () => {
          setBusy(true);
          try {
            await onSave(t.trim() || title, c);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save.');
          }
          setBusy(false);
        }}
      />
    </Sheet>
  );
}

export type { Day };
