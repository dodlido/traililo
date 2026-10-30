import { whereIsToday, type Today } from './today.ts';
import { PHOTOS, photoCredit, photoPage } from './photos.ts';
import { deletePhoto, photoUrlOf, uploadPhoto } from './backend.ts';
import { shrink } from './image.ts';
import { parseGpx } from './gpx.ts';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CommuteEntry, Day, Entry, ExperienceEntry, HikeEntry, ImportReport, Leg, Link, Stay, Trip } from './model.ts';
import { MapView, type Focus, type Tracks } from './MapView.tsx';
import { Icon, modeIcon } from './Icon.tsx';
import { COVER, Scene, themeFor } from './scenes.tsx';
import type { Bundle } from './backend.ts';
import { OfflineCard } from './OfflineCard.tsx';
import { Plan } from './Plan.tsx';
import { JournalBlock, JournalEditor } from './Journal.tsx';
import { DayWeather } from './DayWeather.tsx';
import { AddMenu, DayEditor, EntryEditor, SettingsEditor, StayEditor, type SheetState } from './Edit.tsx';
import { fresh, saveTrip } from './backend.ts';
import { computeTotals } from './totals.ts';
import { THEMES } from './scenes.tsx';
import { countryName, dayOfMonth, minutes, monthShort, nightOf, regionRuns, shortDate, stayById, weekday } from './derive.ts';

interface TripData {
  base: string;
  owner: boolean;
  trip: Trip;
  title: string;
  report?: ImportReport;
  sheet: Record<string, Record<string, string>>;
  tracks: Tracks;
  runs: ReturnType<typeof regionRuns>;
  staysById: ReturnType<typeof stayById>;
  editing: boolean;
  openSheet: (s: SheetState) => void;
  mutate: (fn: (t: Trip) => void) => Promise<void>;
  setTrack: (id: string, track: Tracks[string] | null, gain?: number) => Promise<void>;
}
const TripCtx = createContext<TripData>(null as unknown as TripData);
const useT = () => useContext(TripCtx);
const ShowCtx = createContext<(id: string) => void>(() => {});
const TodayCtx = createContext<Today | null>(null);
const km = (v: number) => `${Math.round(v * 10) / 10} km`;
const PERSONAL_NOTE = /^Assumed:/i;

type Route = { tab: 'journey' | 'map' | 'stays' | 'plan'; chapter: number | null };
function parseSub(sub: string, runsLen: number): Route {
  const h = sub.replace(/^\/+/, '');
  const m = /^chapter\/(\d+)$/.exec(h);
  if (m && +m[1] < runsLen) return { tab: 'journey', chapter: +m[1] };
  if (h === 'map' || h === 'stays' || h === 'plan') return { tab: h, chapter: null };
  return { tab: 'journey', chapter: null };
}
const useDesktop = () => {
  const q = '(min-width: 1000px)';
  const [d, setD] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setD(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return d;
};

export function TripApp({ bundle, base, sub }: { bundle: Bundle; base: string; sub: string }) {
  const [trip, setTrip] = useState(bundle.trip);
  const tripRef = useRef(trip);
  const versionRef = useRef(bundle.version);
  const [tracks, setTracks] = useState(bundle.tracks);
  const tracksRef = useRef(tracks);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [editing, setEditing] = useState(() => bundle.owner && fresh.id === bundle.id);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [title, setTitle] = useState(bundle.title);
  const [cover, setCover] = useState(bundle.cover);
  const flash = (text: string, bad?: boolean) => {
    setToast({ text, bad });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), bad ? 6000 : 1800);
  };
  // Every change is applied to a copy, shown at once, and saved; if the save fails the change is undone.
  const commit = (fn: (t: Trip) => void, meta?: { title: string; cover: string }) => {
    const run = async () => {
      const before = tripRef.current;
      const next = structuredClone(before);
      fn(next);
      next.totals = computeTotals(next);
      tripRef.current = next;
      setTrip(next);
      try {
        versionRef.current = await saveTrip({ ...bundle, tracks: tracksRef.current, title: meta?.title ?? title, cover: meta?.cover ?? cover, version: versionRef.current }, next);
        flash('Saved');
      } catch (e) {
        tripRef.current = before;
        setTrip(before);
        flash(e instanceof Error ? e.message : 'Could not save', true);
        throw e;
      }
    };
    const p = queue.current.then(run, run);
    queue.current = p.catch(() => {});
    return p as Promise<void>;
  };
  // a drawn trail for a hike: kept with the trip, saved with it, and undone if the save fails
  const setTrack = async (id: string, track: Tracks[string] | null, gain?: number) => {
    const before = tracksRef.current;
    const next = { ...before };
    if (track) next[id] = track;
    else delete next[id];
    tracksRef.current = next;
    setTracks(next);
    try {
      await commit((t) => {
        if (!track) return;
        // a hike with no distance or climb in the sheet takes them from the file
        for (const d of t.days) for (const e of d.entries) if (e.id === id && e.kind === 'hike') {
          if (e.distanceKm === undefined) e.distanceKm = track.km;
          if (e.elevationGainM === undefined && gain) e.elevationGainM = gain;
        }
      });
    } catch (e) {
      tracksRef.current = before;
      setTracks(before);
      throw e;
    }
  };
  const data = useMemo<TripData>(
    () => ({ base, owner: bundle.owner, trip, title, report: bundle.report, sheet: bundle.sources ?? {}, tracks, runs: regionRuns(trip), staysById: stayById(trip), editing: editing && bundle.owner, openSheet: setSheet, mutate: commit, setTrack }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundle, base, trip, title, editing, tracks],
  );
  const { runs, staysById } = data;
  // friends' view: no to-dos, addresses, phone numbers or booking details. Friends only ever get that data; the owner can preview it.
  const [preview, setPreview] = useState(false);
  const shared = !bundle.owner || preview;
  const setShared = setPreview;
  const route = useMemo(() => parseSub(sub, runs.length), [sub, runs.length]);
  const today = useMemo(() => whereIsToday(trip), [trip]);
  const [active, setActive] = useState(() => (today.state === 'during' ? today.date : trip.days[0].date));
  const pendingDate = useRef<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const desktop = useDesktop();
  const page = useRef<HTMLDivElement>(null);
  const days = trip.days;
  const activeIdx = Math.max(0, days.findIndex((d) => d.date === active));
  const activeDay = days[activeIdx];

  const go = (hash: string) => {
    location.hash = hash ? `${base}/${hash}` : base;
  };

  // new screen: back to the top; opening a chapter selects its first day
  useEffect(() => {
    page.current?.scrollTo({ top: 0 });
    if (route.chapter !== null) {
      const run = runs[route.chapter];
      const date = pendingDate.current;
      if (date && run.days.some((d) => d.date === date)) {
        pendingDate.current = null;
        setActive(date);
        window.setTimeout(() => document.getElementById(`day-${date}`)?.scrollIntoView({ block: 'start' }), 60);
      } else setActive(run.days[0].date);
    }
  }, [route.tab, route.chapter]);

  const chapterOfToday = today.state === 'during' ? runs.findIndex((r) => r.days.some((d) => d.date === trip.days[today.idx].date)) : -1;
  const openDay = (date: string) => {
    const at = runs.findIndex((r) => r.days.some((d) => d.date === date));
    if (at < 0) return;
    if (route.tab === 'journey' && route.chapter === at) {
      setActive(date);
      document.getElementById(`day-${date}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      pendingDate.current = date;
      go(`chapter/${at}`);
    }
  };
  const openToday = () => {
    if (chapterOfToday >= 0) openDay(trip.days[today.idx].date);
  };
  // opening the app on a day of the trip lands on that day
  useEffect(() => {
    if (today.state === 'during' && route.tab === 'journey' && route.chapter === null && sessionStorage.getItem('traililo:landed') !== bundle.id) {
      try {
        sessionStorage.setItem('traililo:landed', bundle.id);
      } catch {
        /* fine */
      }
      openToday();
    }
  }, []);

  // the day in the middle of the screen is the day the map shows
  useEffect(() => {
    if (route.chapter === null || !page.current) return;
    const io = new IntersectionObserver(
      (hits) => {
        for (const h of hits) if (h.isIntersecting) setActive(h.target.id.replace('day-', ''));
      },
      { root: page.current, rootMargin: '-35% 0px -55% 0px' },
    );
    page.current.querySelectorAll('.day').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [route.chapter]);

  const labelFor = useMemo(() => (d: Day) => (d.stayId ? staysById.get(d.stayId)?.name : undefined) ?? d.region, []);
  const theme = themeFor(activeDay.region);
  const mapVisible = desktop || route.tab === 'map';
  const showOnMap = (id: string) => {
    setActive(id.slice(0, 10));
    setFocus({ id, n: Date.now() });
    if (!desktop) go('map');
  };
  const step = (n: number) => setActive(days[Math.min(days.length - 1, Math.max(0, activeIdx + n))].date);

  return (
    <TripCtx.Provider value={data}>
    <ShowCtx.Provider value={showOnMap}>
    <TodayCtx.Provider value={today}>
    <div className={`shell${shared ? ' is-shared' : ''}`} data-tab={route.tab} style={{ ['--accent' as string]: theme.accent }}>
      <section className="pane">
        <div className="page" ref={page}>
          {route.tab === 'journey' && route.chapter === null && <Journey shared={shared} setShared={setShared} go={go} editing={editing} setEditing={setEditing} openToday={openToday} />}
          {route.tab === 'journey' && route.chapter !== null && <Chapter idx={route.chapter} shared={shared} active={active} go={go} showOnMap={() => go('map')} desktop={desktop} />}
          {route.tab === 'stays' && <Stays shared={shared} go={go} />}
          {route.tab === 'plan' && !shared && bundle.owner && <Plan trip={trip} mutate={commit} openDay={openDay} base={base} />}
          {route.tab === 'map' && !desktop && <div className="page-spacer" />}
        </div>
        <nav className="tabs" aria-label="Sections">
          <Tab icon="journey" label="Journey" on={route.tab === 'journey'} onClick={() => go('')} />
          {!desktop && <Tab icon="map" label="Map" on={route.tab === 'map'} onClick={() => go('map')} />}
          <Tab icon="bed" label="Stays" on={route.tab === 'stays'} onClick={() => go('stays')} />
          {bundle.owner && !shared && <Tab icon="flag" label="Plan" on={route.tab === 'plan'} onClick={() => go('plan')} />}
        </nav>
      </section>

      <section className="map-pane" aria-hidden={!mapVisible}>
        <MapView trip={trip} active={active} labelFor={labelFor} visible={mapVisible} tracks={tracks} focus={focus} />
        <div className="map-day">
          <button type="button" aria-label="Previous day" onClick={() => step(-1)} disabled={activeIdx === 0}>
            <Icon name="back" size={20} />
          </button>
          <div>
            <b>{labelFor(activeDay)}</b>
            <span>
              {weekday(activeDay.date)} {shortDate(activeDay.date)}
            </span>
          </div>
          <button type="button" aria-label="Next day" onClick={() => step(1)} disabled={activeIdx === days.length - 1}>
            <Icon name="next" size={20} />
          </button>
        </div>
      </section>
      {toast && <div className={toast.bad ? 'toast bad' : 'toast'} role="status">{toast.text}</div>}
      {sheet?.type === 'add' && <AddMenu date={sheet.date} open={setSheet} onClose={() => setSheet(null)} />}
      {sheet?.type === 'entry' && <EntryEditor key={`${sheet.date}${sheet.id ?? sheet.kind}`} trip={trip} mutate={commit} date={sheet.date} id={sheet.id} kind={sheet.kind} onClose={() => setSheet(null)} />}
      {sheet?.type === 'stay' && <StayEditor key={sheet.id ?? 'new'} trip={trip} mutate={commit} id={sheet.id} date={sheet.date} onClose={() => setSheet(null)} />}
      {sheet?.type === 'journal' && <JournalEditor key={sheet.date} trip={trip} tripId={bundle.id} mutate={commit} date={sheet.date} onClose={() => setSheet(null)} />}
      {sheet?.type === 'day' && <DayEditor trip={trip} mutate={commit} date={sheet.date} onClose={() => setSheet(null)} />}
      {sheet?.type === 'settings' && (
        <SettingsEditor
          title={title}
          cover={cover}
          themes={Object.keys(THEMES)}
          onClose={() => setSheet(null)}
          onSave={async (t, c) => {
            await commit(() => {}, { title: t, cover: c });
            setTitle(t);
            setCover(c);
          }}
        />
      )}
    </div>
    </TodayCtx.Provider>
    </ShowCtx.Provider>
    </TripCtx.Provider>
  );
}

function Tab({ icon, label, on, onClick }: { icon: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={on ? 'tab is-on' : 'tab'} aria-current={on ? 'page' : undefined} onClick={onClick}>
      <Icon name={icon} size={24} />
      <span>{label}</span>
    </button>
  );
}

function Journey({ shared, setShared, go, editing, setEditing, openToday }: { shared: boolean; setShared: (v: boolean) => void; go: (h: string) => void; editing: boolean; setEditing: (v: boolean) => void; openToday: () => void }) {
  const { trip, runs, base, owner, title, openSheet, staysById, tracks } = useT();
  const today = useContext(TodayCtx)!;
  const nowDay = trip.days[today.idx];
  const nowStay = nowDay.stayId ? staysById.get(nowDay.stayId)?.name : undefined;
  const t = trip.totals;
  const countries = [...new Set(trip.days.map((d) => d.country).filter(Boolean))].map((c) => countryName[c as string]);
  return (
    <>
      <header className="cover">
        <Scene region={title} theme={COVER} seed="cover" photo={false} className="cover-scene" />
        <div className="cover-top">
          <a className="round back-home" href="#/" aria-label="All trips">
            <Icon name="back" size={22} />
          </a>
          <span className="wordmark">TraiLilo</span>
          {owner && (
            <>
              {!shared && (
                <button type="button" className={editing ? 'chip is-on' : 'chip'} aria-pressed={editing} onClick={() => setEditing(!editing)}>
                  <Icon name="edit" size={16} /> {editing ? 'Done' : 'Edit'}
                </button>
              )}
              <button type="button" className={shared ? 'chip is-on' : 'chip'} aria-pressed={shared} onClick={() => { setShared(!shared); setEditing(false); }}>
                <Icon name="eye" size={16} /> {shared ? 'Friends’ view' : 'Your view'}
              </button>
            </>
          )}
        </div>
        <div className="cover-text">
          <p className="eyebrow">
            {monthShort(trip.startDate)} {dayOfMonth(trip.startDate)} to {monthShort(trip.endDate)} {dayOfMonth(trip.endDate)}, {trip.endDate.slice(0, 4)}
          </p>
          <h1>{title}</h1>
          {editing && owner && !shared && (
            <button type="button" className="chip" onClick={() => openSheet({ type: 'settings' })}><Icon name="edit" size={16} /> Trip settings</button>
          )}
          <p className="cover-sub">
            {t.days} days · {countries.join(' and ')}
          </p>
        </div>
      </header>

      <TodayCard today={today} start={trip.days[0].date} where={nowStay ?? nowDay.region} onOpen={openToday} />
      <OfflineCard trip={trip} tracks={tracks} />

      <div className="strip" role="list" aria-label="The route, by place">
        {runs.map((run, i) => (
          <a key={i} role="listitem" href={`${base}/chapter/${i}`} style={{ flexGrow: run.days.length, background: themeFor(run.region).accent }} title={run.region} aria-label={run.region} />
        ))}
      </div>

      <section className="chapters" aria-label="Places">
        {runs.map((run, i) => {
          const th = themeFor(run.region);
          const kinds = new Set(run.days.flatMap((d) => d.entries.map((e) => (e.kind === 'commute' ? modeIcon((e as CommuteEntry).legs[0]?.mode) : e.kind === 'hike' ? 'hike' : e.kind === 'experience' ? 'spark' : ''))));
          kinds.delete('');
          return (
            <a className="chapter-card" key={i} href={`${base}/chapter/${i}`} style={{ ['--accent' as string]: th.accent }}>
              {today.state === 'during' && run.days.some((d) => d.date === nowDay.date) && <span className="now-badge">Day {today.n} · now</span>}
              <Scene region={run.region} theme={th} src={trip.photos?.[run.region] ? photoUrlOf(trip.photos[run.region]) : undefined} />
              <div className="chapter-card-text">
                <h2>{run.region}</h2>
                <p>
                  {run.country ? countryName[run.country] : ''} · {shortDate(run.days[0].date)}
                  {run.days.length > 1 ? ` to ${shortDate(run.days[run.days.length - 1].date)}` : ''}
                </p>
              </div>
              <span className="kinds">{[...kinds].map((k) => <Icon key={k} name={k} size={17} />)}</span>
            </a>
          );
        })}
      </section>

      <details className="photo-credits">
        <summary>Photo credits</summary>
        <ul>
          {runs.filter((r) => PHOTOS[r.region] && !trip.photos?.[r.region]).map((r) => (
            <li key={r.region}>
              {r.region}: <a href={photoPage(PHOTOS[r.region])} target="_blank" rel="noopener noreferrer">{PHOTOS[r.region].by}</a>, {PHOTOS[r.region].licence}, Wikimedia Commons
            </li>
          ))}
        </ul>
      </details>

      {owner && !shared && (
        <details className="notes-fold">
          <summary>Import notes (only you see this)</summary>
          <ImportNotes />
        </details>
      )}
    </>
  );
}

function Chapter({ idx, shared, active, go, showOnMap, desktop }: { idx: number; shared: boolean; active: string; go: (h: string) => void; showOnMap: () => void; desktop: boolean }) {
  const { runs, base, trip, owner, editing, mutate } = useT();
  const run = runs[idx];
  const mine = trip.photos?.[run.region];
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const canPhoto = owner && editing && !shared;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    setBusy('Uploading…');
    try {
      const path = await uploadPhoto(await shrink(file), trip.id);
      const old = mine;
      await mutate((t) => {
        (t.photos ??= {})[run.region] = path;
      });
      if (old) deletePhoto(old);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not upload that picture');
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!mine) return;
    setBusy('Removing…');
    try {
      await mutate((t) => {
        if (t.photos) delete t.photos[run.region];
      });
      deletePhoto(mine);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not remove it');
    } finally {
      setBusy(null);
    }
  };
  const th = themeFor(run.region);
  return (
    <div className="chapter" style={{ ['--accent' as string]: th.accent }}>
      <header className="chapter-hero">
        <Scene region={run.region} theme={th} src={mine ? photoUrlOf(mine) : undefined} />
        <button type="button" className="round back" aria-label="Back to the journey" onClick={() => go('')}>
          <Icon name="back" size={22} />
        </button>
        {!desktop && (
          <button type="button" className="chip on-map" onClick={showOnMap}>
            <Icon name="map" size={16} /> Map
          </button>
        )}
        <div className="chapter-hero-text">
          <p className="eyebrow">
            {run.country ? countryName[run.country] : ''} · {shortDate(run.days[0].date)}
            {run.days.length > 1 ? ` to ${shortDate(run.days[run.days.length - 1].date)}` : ''}
          </p>
          <h1>{run.region}</h1>
        </div>
        {canPhoto && (
          <div className="photo-edit">
            <label className="chip">
              <Icon name="plus" size={16} /> {busy ?? (mine ? 'Change photo' : 'Add photo')}
              <input type="file" accept="image/*" hidden disabled={!!busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {mine && !busy && (
              <button type="button" className="chip" onClick={() => void remove()}>
                Remove
              </button>
            )}
            {problem && <p className="photo-problem">{problem}</p>}
          </div>
        )}
        {!mine && PHOTOS[run.region] && (
          <a className="photo-credit" href={photoPage(PHOTOS[run.region])} target="_blank" rel="noopener noreferrer">
            {photoCredit(PHOTOS[run.region])}
          </a>
        )}
      </header>
      <ol className="days">
        {run.days.map((d) => (
          <DayCard key={d.date} day={d} shared={shared} active={d.date === active} />
        ))}
      </ol>
      <nav className="chapter-nav">
        {idx > 0 && (
          <a href={`${base}/chapter/${idx - 1}`}>
            <Icon name="back" size={18} /> {runs[idx - 1].region}
          </a>
        )}
        {idx < runs.length - 1 && (
          <a href={`${base}/chapter/${idx + 1}`} className="next">
            {runs[idx + 1].region} <Icon name="next" size={18} />
          </a>
        )}
      </nav>
    </div>
  );
}

function Stays({ shared }: { shared: boolean; go: (h: string) => void }) {
  const { trip, base, editing, openSheet } = useT();
  return (
    <>
      <header className="page-head">
        <h1>Where you sleep</h1>
      </header>
      <ul className="stay-list">
        {trip.stays.map((s) => {
          const region = trip.days.find((d) => d.stayId === s.id)?.region ?? '';
          const th = themeFor(region);
          return (
            <li key={s.id} className="stay-card" style={{ ['--accent' as string]: th.accent }}>
              <Scene region={region} theme={th} className="stay-art" />
              <div>
                {editing && !shared && (
                  <button type="button" className="round small edit-btn" aria-label={`Edit ${s.name}`} onClick={() => openSheet({ type: 'stay', id: s.id })}>
                    <Icon name="edit" size={16} />
                  </button>
                )}
                <h2>{s.name}</h2>
                <p>
                  {region} · {shortDate(s.checkIn)} to {shortDate(s.checkOut)}
                </p>
                {s.assumed && <span className="tag">to be booked</span>}
                {!shared && s.booking?.bookedBy && <span className="tag soft">booked by {s.booking.bookedBy}</span>}
                {!shared && s.privateNotes.map((p) => (
                  <span className="private-line" key={p}>
                    {p}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && !shared && (
        <p className="foot-link">
          <button type="button" className="add-btn" onClick={() => openSheet({ type: 'stay' })}>
            <Icon name="plus" size={18} /> Add a place to sleep
          </button>
        </p>
      )}
      <p className="foot-link">
        <a href={base}>Back to the journey</a>
      </p>
    </>
  );
}

function DayCard({ day, shared, active }: { day: Day; shared: boolean; active: boolean }) {
  const { staysById, sheet, owner, editing, openSheet, mutate, trip } = useT();
  const today = useContext(TodayCtx)!;
  const isToday = today.state === 'during' && trip_dayIs(today, day.date);
  const [newTodo, setNewTodo] = useState('');
  const canEdit = editing && !shared;
  const stay = day.stayId ? staysById.get(day.stayId) : undefined;
  const shownWarnings = new Set(day.entries.flatMap((e) => e.warnings));
  const todos = shared ? [] : day.todos.filter((td) => !shownWarnings.has(td.text));
  const nothing = day.entries.length === 0 && todos.length === 0;
  return (
    <li className={`day${active ? ' is-active' : ''}${isToday ? ' is-today' : ''}`} id={`day-${day.date}`}>
      <div className="day-head">
        <span className="day-num">{dayOfMonth(day.date)}</span>
        <span className="day-when">
          {weekday(day.date)}
          <small>{monthShort(day.date)}</small>
        </span>
        {isToday && <span className="today-pill">Today</span>}
        {canEdit && (
          <button type="button" className="round small edit-btn" aria-label="Edit this day" onClick={() => openSheet({ type: 'day', date: day.date })}>
            <Icon name="edit" size={16} />
          </button>
        )}
      </div>
      <div className="day-body">
        <DayWeather trip={trip} day={day} />
        {day.entries.map((e) => (
          <EntryView key={e.id} entry={e} shared={shared} date={day.date} />
        ))}
        {nothing && <p className="empty">Nothing planned yet.</p>}
        {(todos.length > 0 || canEdit) && !shared && (
          <ul className="todos">
            {todos.map((td) => (
              <li key={td.id} className={`${td.warning ? 'todo todo-warn' : 'todo'}${td.done ? ' is-done' : ''}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={td.done}
                    onChange={() =>
                      mutate((t) => {
                        const x = t.days.find((q) => q.date === day.date)!.todos.find((q) => q.id === td.id);
                        if (x) x.done = !x.done;
                      })
                    }
                  />
                  <span>{td.text}</span>
                </label>
                {canEdit && (
                  <button type="button" className="round small" aria-label="Delete to-do" onClick={() => mutate((t) => { const dd = t.days.find((q) => q.date === day.date)!; dd.todos = dd.todos.filter((q) => q.id !== td.id); })}>
                    <Icon name="close" size={14} />
                  </button>
                )}
              </li>
            ))}
            {canEdit && (
              <li className="todo-add">
                <form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const text = newTodo.trim();
                    if (!text) return;
                    setNewTodo('');
                    mutate((t) => t.days.find((q) => q.date === day.date)!.todos.push({ id: `${day.date}-t${Math.random().toString(36).slice(2, 7)}`, text, done: false }));
                  }}
                >
                  <input placeholder="Add a to-do" value={newTodo} onChange={(ev) => setNewTodo(ev.target.value)} />
                  <button className="chip">Add</button>
                </form>
              </li>
            )}
          </ul>
        )}
        {stay && <StayLine stay={stay} date={day.date} shared={shared} />}
        <JournalBlock day={day} canWrite={!shared && owner && (editing || day.date <= today.date)} onWrite={() => openSheet({ type: 'journal', date: day.date })} />
        {canEdit && (
          <button type="button" className="add-btn" onClick={() => openSheet({ type: 'add', date: day.date })}>
            <Icon name="plus" size={18} /> Add to this day
          </button>
        )}
        {owner && !shared && sheet[day.date] && <SheetText cells={sheet[day.date]} />}
      </div>
    </li>
  );
}

function StayLine({ stay, date, shared }: { stay: Stay; date: string; shared: boolean }) {
  const { editing, openSheet } = useT();
  const night = nightOf(stay, date);
  return (
    <p className="stay">
      <Icon name="bed" size={18} />
      <span className="stay-name">{stay.name}</span>
      {stay.assumed && <span className="tag">to be booked</span>}
      {night && <span className="meta">{night}</span>}
      {!shared && stay.booking?.bookedBy && <span className="meta">booked by {stay.booking.bookedBy}</span>}
      {!shared && stay.privateNotes.map((p) => (
        <span className="meta meta-private" key={p}>
          {p}
        </span>
      ))}
      {editing && !shared && (
        <button type="button" className="round small edit-btn" aria-label="Edit this place to sleep" onClick={() => openSheet({ type: 'stay', id: stay.id })}>
          <Icon name="edit" size={16} />
        </button>
      )}
    </p>
  );
}

function EntryView({ entry: e, shared, date }: { entry: Entry; shared: boolean; date: string }) {
  const { tracks, editing, openSheet, setTrack } = useT();
  const showOnMap = useContext(ShowCtx);
  const [gpxBusy, setGpxBusy] = useState(false);
  const [gpxError, setGpxError] = useState('');
  const loadGpx = async (file: File | undefined) => {
    if (!file) return;
    setGpxError('');
    setGpxBusy(true);
    try {
      const tr = parseGpx(await file.text(), file.name.replace(/\.gpx$/i, ''));
      await setTrack(e.id, { lines: tr.lines, km: tr.km, name: tr.name }, tr.gain);
    } catch (err) {
      setGpxError(err instanceof Error ? err.message : 'Could not read that file');
    } finally {
      setGpxBusy(false);
    }
  };
  const mappable = !!(tracks[e.id] || e.at);
  const notes = shared ? e.notes.filter((n) => !PERSONAL_NOTE.test(n)) : e.notes;
  const icon = e.kind === 'hike' ? 'hike' : e.kind === 'experience' ? 'spark' : e.kind === 'commute' ? modeIcon((e as CommuteEntry).legs[0]?.mode) : 'note';
  return (
    <article className={`entry kind-${e.kind}${e.optional ? ' is-optional' : ''}`}>
      <span className="entry-icon">
        <Icon name={icon} size={20} />
      </span>
      <div className="entry-main">
        <h3>
          {e.title}
          {e.optional && <span className="tag">optional</span>}
          {e.assumed && <span className="tag">assumed</span>}
        </h3>
        <Facts entry={e} />
        {e.warnings.length > 0 && (
          <ul className="warnings">
            {e.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {notes.length > 0 && (
          <ul className="notes">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {!shared && (e.privateNotes ?? []).length > 0 && (
          <ul className="notes private-notes">
            {(e.privateNotes ?? []).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <Links links={e.links} shared={shared} />
        {editing && !shared && (
          <button type="button" className="show-map edit-entry" onClick={() => openSheet({ type: 'entry', date, id: e.id })}>
            <Icon name="edit" size={16} /> Edit
          </button>
        )}
        {editing && !shared && e.kind === 'hike' && (
          <>
            <label className="show-map edit-entry">
              <Icon name="plus" size={16} /> {gpxBusy ? 'Adding…' : tracks[e.id] ? 'Replace GPX trail' : 'Add GPX trail'}
              <input type="file" accept=".gpx,application/gpx+xml,application/octet-stream,text/xml,application/xml" hidden disabled={gpxBusy} onChange={(ev) => { void loadGpx(ev.target.files?.[0]); ev.target.value = ''; }} />
            </label>
            {tracks[e.id] && !gpxBusy && (
              <button type="button" className="show-map edit-entry" onClick={() => setTrack(e.id, null).catch(() => {})}>
                Remove trail
              </button>
            )}
            {gpxError && <p className="photo-problem" style={{ color: '#ff9c8a' }}>{gpxError}</p>}
          </>
        )}
        {mappable && (
          <button type="button" className="show-map" onClick={() => showOnMap(e.id)}>
            <Icon name="map" size={16} /> {tracks[e.id] ? 'Show trail on map' : 'Show on map'}
          </button>
        )}
        {!shared && e.booking && (
          <p className="meta-line">
            {e.booking.bookedBy ? `Booked by ${e.booking.bookedBy}` : 'Booked'}
            {e.booking.source !== 'unspecified' ? ` on ${e.booking.source === 'getyourguide' ? 'GetYourGuide' : 'Airbnb'}` : ''}
          </p>
        )}
      </div>
    </article>
  );
}

function Facts({ entry }: { entry: Entry }) {
  const bits: string[] = [];
  if (entry.kind === 'hike') {
    const h = entry as HikeEntry;
    if (h.distanceKm !== undefined) bits.push(km(h.distanceKm));
    if (h.elevationGainM !== undefined && h.elevationGainM > 0) bits.push(`+${h.elevationGainM.toLocaleString('en-GB')} m`);
    const d = minutes(h.durationMin);
    if (d) bits.push(d);
    if (h.difficulty) bits.push(h.difficulty.replace('-', ' to '));
    if (h.shape) bits.push(h.shape.replace(/-/g, ' '));
    if (h.guided) bits.push('guided');
    return (
      <>
        {bits.length > 0 && <FactRow bits={bits} />}
        {h.options && (
          <ul className="options">
            {h.options.map((o) => (
              <li key={o.label}>
                {o.label}
                {o.distanceKm !== undefined ? `, ${km(o.distanceKm)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  if (entry.kind === 'experience') {
    const x = entry as ExperienceEntry;
    if (x.startTime) bits.push(x.endTime ? `${x.startTime} to ${x.endTime}` : x.startTime);
    if (x.distanceKm !== undefined) bits.push(km(x.distanceKm));
    const d = minutes(x.durationMin);
    if (d) bits.push(d);
    return bits.length ? <FactRow bits={bits} /> : null;
  }
  if (entry.kind === 'commute') {
    const c = entry as CommuteEntry;
    if (c.legs.length > 1) {
      return (
        <ol className="legs">
          {c.legs.map((l, i) => (
            <LegView key={i} leg={l} />
          ))}
        </ol>
      );
    }
    const l = c.legs[0];
    const b: string[] = [];
    const d = minutes(l?.durationMin);
    if (d) b.push(d);
    if (l?.distanceKm !== undefined) b.push(km(l.distanceKm));
    if (l?.note) b.push(l.note);
    return b.length ? <FactRow bits={b} /> : null;
  }
  return null;
}

function LegView({ leg }: { leg: Leg }) {
  const d = minutes(leg.durationMin);
  return (
    <li className={`leg leg-${leg.mode}`}>
      <span className="leg-mode">{leg.mode}</span>
      <span>
        {leg.from} to {leg.to}
      </span>
      {d && <span className="meta">{d}</span>}
      {leg.note && <span className="meta">{leg.note}</span>}
    </li>
  );
}

function FactRow({ bits }: { bits: string[] }) {
  return (
    <p className="facts">
      {bits.map((b) => (
        <span key={b}>{b}</span>
      ))}
    </p>
  );
}

function Links({ links, shared }: { links: Link[]; shared: boolean }) {
  const shown = shared ? links.filter((l) => l.url) : links;
  if (shown.length === 0) return null;
  return (
    <p className="links">
      {shown.map((l) =>
        l.url ? (
          <a key={l.label} href={l.url} target="_blank" rel="noreferrer">
            {l.label}
          </a>
        ) : (
          <span key={l.label} className="link-todo">
            {l.label}, add link
          </span>
        ),
      )}
    </p>
  );
}

function SheetText({ cells }: { cells: Record<string, string> }) {
  const rows = (
    [
      ['Commute', cells.commute],
      ['Plans', cells.plans],
      ['Stay', cells.accommodation],
      ['To-dos', cells.todos],
    ] as const
  ).filter(([, v]) => v && v.trim() !== '');
  if (rows.length === 0) return null;
  return (
    <details className="sheet">
      <summary>Original sheet text</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ImportNotes() {
  const { report } = useT();
  if (!report) return null;
  const confirm = report.notes.filter((n) => n.severity === 'confirm');
  const fixed = report.notes.filter((n) => n.severity === 'fixed');
  return (
    <section className="import-notes" aria-labelledby="import-h">
      <h2 id="import-h">What the import wasn’t sure about</h2>
      <p className="lede">
        {report.rowsRead} sheet rows read. Check these and tell me what to change.
      </p>
      <ol>
        {confirm.map((n, i) => (
          <li key={i}>{n.message}</li>
        ))}
      </ol>
      <h3>Fixed automatically</h3>
      <ul>
        {fixed.map((n, i) => (
          <li key={i}>{n.message}</li>
        ))}
      </ul>
    </section>
  );
}

/** Today's date, as a listed day (a gap day counts as the one before it). */
function trip_dayIs(today: Today, date: string) {
  return today.date === date;
}

function TodayCard({ today, start, where, onOpen }: { today: Today; start: string; where: string; onOpen: () => void }) {
  if (today.state === 'before')
    return (
      <section className="today-card" aria-label="Countdown">
        <b className="today-big">{today.daysTo === 1 ? 'Tomorrow' : today.daysTo}</b>
        <span className="today-text">
          {today.daysTo === 1 ? 'the trip begins' : 'days to go'}
          <small>Starts {weekday(start)} {shortDate(start)}</small>
        </span>
      </section>
    );
  if (today.state === 'after')
    return (
      <section className="today-card" aria-label="Trip finished">
        <span className="today-text">
          Home again
          <small>{today.daysSince === 0 ? 'The trip ended today' : `The trip ended ${today.daysSince} ${today.daysSince === 1 ? 'day' : 'days'} ago`}</small>
        </span>
      </section>
    );
  return (
    <button type="button" className="today-card is-live" onClick={onOpen}>
      <b className="today-big">{today.n}</b>
      <span className="today-text">
        Day {today.n} of {today.total}
        <small>{where}</small>
      </span>
      <span className="today-go">
        Today <Icon name="next" size={18} />
      </span>
    </button>
  );
}
