// Editing, for the trip's owner. Everything opens as a bottom sheet; "Save" writes to the database straight away.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CommuteEntry, Day, Entry, ExperienceEntry, HikeEntry, Leg, Link, Point, Stay, StayType, Trip, TransportMode } from './model.ts';
import { searchPlace, type Found } from './geocode.ts';
import { Icon } from './Icon.tsx';

export type SheetState =
  | { type: 'add'; date: string }
  | { type: 'entry'; date: string; id?: string; kind?: Entry['kind'] }
  | { type: 'stay'; id?: string; date?: string }
  | { type: 'day'; date: string }
  | { type: 'journal'; date: string }
  | { type: 'settings' };

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

export function PlaceSearch({ onPick, current, onClear }: { onPick: (name: string, p: Point) => void; current?: Point; onClear: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Found[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
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
          placeholder="Search a place to pin it on the map"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go();
            }
          }}
        />
        <button type="button" className="chip" onClick={go} disabled={busy}>{busy ? '…' : 'Find'}</button>
      </div>
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

export function AddMenu({ date, open, onClose }: { date: string; open: (s: SheetState) => void; onClose: () => void }) {
  const items: { kind: Entry['kind']; label: string; icon: string }[] = [
    { kind: 'hike', label: 'Hike', icon: 'hike' },
    { kind: 'experience', label: 'Activity', icon: 'spark' },
    { kind: 'commute', label: 'Getting there', icon: 'bus' },
    { kind: 'note', label: 'Note', icon: 'note' },
  ];
  return (
    <Sheet title="Add to this day" onClose={onClose}>
      <div className="add-grid">
        {items.map((i) => (
          <button key={i.kind} type="button" onClick={() => open({ type: 'entry', date, kind: i.kind })}>
            <Icon name={i.icon} size={26} />
            <span>{i.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => open({ type: 'stay', date })}>
          <Icon name="bed" size={26} />
          <span>Place to sleep</span>
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- entries

const MODES: TransportMode[] = ['flight', 'bus', 'drive', 'ferry', 'taxi'];

export function EntryEditor({ trip, mutate, date, id, kind, onClose }: { trip: Trip; mutate: Mutate; date: string; id?: string; kind?: Entry['kind']; onClose: () => void }) {
  const existing = useMemo(() => (id ? trip.days.find((d) => d.date === date)?.entries.find((e) => e.id === id) : undefined), [trip, date, id]);
  const base: Entry = useMemo(
    () =>
      existing
        ? structuredClone(existing)
        : ({ id: `${date}-n${rid()}`, kind: kind ?? 'note', title: '', notes: [], warnings: [], links: [], ...(kind === 'commute' ? { legs: [{ mode: 'bus' }] } : {}) } as Entry),
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
  const up = (patch: Record<string, unknown>) => setD((p) => ({ ...p, ...patch }) as Entry);
  const h = d as HikeEntry;
  const x = d as ExperienceEntry;
  const c = d as CommuteEntry;
  const dur = h.durationMin;
  const setDur = (hh: string, mm: string) => {
    const total = (num(hh) ?? 0) * 60 + (num(mm) ?? 0);
    up({ durationMin: hh === '' && mm === '' ? undefined : total });
  };
  const isNew = !existing;
  const dayEntries = trip.days.find((dd) => dd.date === date)?.entries ?? [];
  const pos = dayEntries.findIndex((e) => e.id === id);

  const save = () => {
    if (!d.title.trim() && d.kind !== 'commute') return setErr('Give it a name first.');
    setErr(null);
    const out: Entry = {
      ...d,
      title: d.title.trim() || (c.legs?.[0] ? `${c.legs[0].mode} ${c.legs[0].from ?? ''} to ${c.legs[0].to ?? ''}`.trim() : 'Getting there'),
      notes: lines(notes),
      warnings: lines(warn),
      privateNotes: lines(priv),
      links: links.filter((l) => l.label.trim() || l.url).map((l) => ({ ...l, label: l.label.trim() || l.url || 'Link', url: l.url?.trim() || undefined })),
    };
    run((t) => {
      const from = t.days.find((dd) => dd.date === date)!;
      const to = t.days.find((dd) => dd.date === day)!;
      if (existing && date === day) from.entries = from.entries.map((e) => (e.id === out.id ? out : e));
      else {
        from.entries = from.entries.filter((e) => e.id !== out.id);
        to.entries.push(out);
      }
    });
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

  const kindLabel = { hike: 'hike', experience: 'activity', commute: 'travel', note: 'note' }[d.kind];
  return (
    <Sheet title={isNew ? `New ${kindLabel}` : `Edit ${kindLabel}`} onClose={onClose}>
      <Field label={d.kind === 'commute' ? 'Title (optional)' : 'Name'}>
        <input value={d.title} onChange={(e) => up({ title: e.target.value })} autoFocus={isNew} />
      </Field>

      {d.kind === 'hike' && (
        <>
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

      {d.kind === 'commute' && (
        <div className="legs-edit">
          <h3>Legs</h3>
          {(c.legs ?? []).map((l: Leg, i: number) => (
            <div className="leg-row" key={i}>
              <select value={l.mode} onChange={(e) => up({ legs: c.legs.map((q, j) => (j === i ? { ...q, mode: e.target.value as TransportMode } : q)) })}>
                {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input placeholder="From" value={l.from ?? ''} onChange={(e) => up({ legs: c.legs.map((q, j) => (j === i ? { ...q, from: e.target.value } : q)) })} />
              <input placeholder="To" value={l.to ?? ''} onChange={(e) => up({ legs: c.legs.map((q, j) => (j === i ? { ...q, to: e.target.value } : q)) })} />
              <input placeholder="min" type="number" inputMode="numeric" value={l.durationMin ?? ''} onChange={(e) => up({ legs: c.legs.map((q, j) => (j === i ? { ...q, durationMin: num(e.target.value) } : q)) })} />
              <button type="button" className="round small" aria-label="Remove leg" onClick={() => up({ legs: c.legs.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
            </div>
          ))}
          <button type="button" className="chip" onClick={() => up({ legs: [...(c.legs ?? []), { mode: 'bus' }] })}>+ Add a leg</button>
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
        <PlaceSearch current={d.at} onPick={(_, p) => up({ at: p })} onClear={() => up({ at: undefined })} />
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
      <Actions onSave={save} busy={busy} error={err ?? error} onDelete={isNew ? undefined : remove} />
    </Sheet>
  );
}

// ---------------------------------------------------------------- stays

export function StayEditor({ trip, mutate, id, date, onClose }: { trip: Trip; mutate: Mutate; id?: string; date?: string; onClose: () => void }) {
  const existing = id ? trip.stays.find((s) => s.id === id) : undefined;
  const base = useMemo<Stay>(
    () =>
      existing
        ? structuredClone(existing)
        : { id: `stay-${rid()}`, name: '', type: 'hotel', checkIn: date ?? trip.startDate, checkOut: addDays(date ?? trip.startDate, 1), nights: 1, notes: [], privateNotes: [] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [s, setS] = useState<Stay>(base);
  const [notes, setNotes] = useState(base.notes.join('\n'));
  const [priv, setPriv] = useState(base.privateNotes.join('\n'));
  const [err, setErr] = useState<string | null>(null);
  const { busy, error, run } = useSave(mutate, onClose);
  const up = (p: Partial<Stay>) => setS((q) => ({ ...q, ...p }));
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
  const types: StayType[] = ['hotel', 'airbnb', 'lodge', 'refugio', 'camp', 'glamping', 'other'];
  return (
    <Sheet title={existing ? 'Edit place to sleep' : 'New place to sleep'} onClose={onClose}>
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
          <select value={s.booking?.source ?? 'unspecified'} onChange={(e) => up({ booking: { ...s.booking, source: e.target.value as 'airbnb' | 'getyourguide' | 'unspecified' } })}>
            <option value="unspecified">—</option><option value="airbnb">Airbnb</option><option value="getyourguide">GetYourGuide</option>
          </select>
        </Field>
      </div>
      <Field label="Notes" hint="One per line. Friends see these."><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Field label="Private (address, phone, door code)" hint="Only you see these."><textarea rows={3} value={priv} onChange={(e) => setPriv(e.target.value)} /></Field>
      <Field label="Where on the map"><PlaceSearch current={s.point} onPick={(_, p) => up({ point: p })} onClear={() => up({ point: undefined })} /></Field>
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
      <Field label="Where on the map"><PlaceSearch current={point} onPick={(_, p) => setPoint(p)} onClear={() => setPoint(undefined)} /></Field>
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
