import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CommuteEntry, Day, Entry, ExperienceEntry, HikeEntry, ImportReport, Leg, Link, Stay, Trip } from './model.ts';
import { MapView, type Focus, type Tracks } from './MapView.tsx';
import { Icon, modeIcon } from './Icon.tsx';
import { COVER, Scene, themeFor } from './scenes.tsx';
import type { Bundle } from './backend.ts';
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
}
const TripCtx = createContext<TripData>(null as unknown as TripData);
const useT = () => useContext(TripCtx);
const ShowCtx = createContext<(id: string) => void>(() => {});
const km = (v: number) => `${Math.round(v * 10) / 10} km`;
const PERSONAL_NOTE = /^Assumed:/i;

type Route = { tab: 'journey' | 'map' | 'stays'; chapter: number | null };
function parseSub(sub: string, runsLen: number): Route {
  const h = sub.replace(/^\/+/, '');
  const m = /^chapter\/(\d+)$/.exec(h);
  if (m && +m[1] < runsLen) return { tab: 'journey', chapter: +m[1] };
  if (h === 'map' || h === 'stays') return { tab: h, chapter: null };
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
  const trip = bundle.trip;
  const data = useMemo<TripData>(
    () => ({ base, owner: bundle.owner, trip, title: bundle.title, report: bundle.report, sheet: bundle.sources ?? {}, tracks: bundle.tracks, runs: regionRuns(trip), staysById: stayById(trip) }),
    [bundle, base, trip],
  );
  const { runs, staysById, tracks } = data;
  // friends' view: no to-dos, addresses, phone numbers or booking details. Friends only ever get that data; the owner can preview it.
  const [preview, setPreview] = useState(false);
  const shared = !bundle.owner || preview;
  const setShared = setPreview;
  const route = useMemo(() => parseSub(sub, runs.length), [sub, runs.length]);
  const [active, setActive] = useState(trip.days[0].date);
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
    if (route.chapter !== null) setActive(runs[route.chapter].days[0].date);
  }, [route.tab, route.chapter]);

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
    <div className={`shell${shared ? ' is-shared' : ''}`} data-tab={route.tab} style={{ ['--accent' as string]: theme.accent }}>
      <section className="pane">
        <div className="page" ref={page}>
          {route.tab === 'journey' && route.chapter === null && <Journey shared={shared} setShared={setShared} go={go} />}
          {route.tab === 'journey' && route.chapter !== null && <Chapter idx={route.chapter} shared={shared} active={active} go={go} showOnMap={() => go('map')} desktop={desktop} />}
          {route.tab === 'stays' && <Stays shared={shared} go={go} />}
          {route.tab === 'map' && !desktop && <div className="page-spacer" />}
        </div>
        <nav className="tabs" aria-label="Sections">
          <Tab icon="journey" label="Journey" on={route.tab === 'journey'} onClick={() => go('')} />
          {!desktop && <Tab icon="map" label="Map" on={route.tab === 'map'} onClick={() => go('map')} />}
          <Tab icon="bed" label="Stays" on={route.tab === 'stays'} onClick={() => go('stays')} />
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
    </div>
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

function Journey({ shared, setShared, go }: { shared: boolean; setShared: (v: boolean) => void; go: (h: string) => void }) {
  const { trip, runs, base, owner, title } = useT();
  const t = trip.totals;
  const countries = [...new Set(trip.days.map((d) => d.country).filter(Boolean))].map((c) => countryName[c as 'AR' | 'CL']);
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
            <button type="button" className={shared ? 'chip is-on' : 'chip'} aria-pressed={shared} onClick={() => setShared(!shared)}>
              <Icon name="eye" size={16} /> {shared ? 'Friends’ view' : 'Your view'}
            </button>
          )}
        </div>
        <div className="cover-text">
          <p className="eyebrow">
            {monthShort(trip.startDate)} {dayOfMonth(trip.startDate)} to {monthShort(trip.endDate)} {dayOfMonth(trip.endDate)}, {trip.endDate.slice(0, 4)}
          </p>
          <h1>{title}</h1>
          <p className="cover-sub">
            {t.days} days · {countries.join(' and ')}
          </p>
        </div>
      </header>

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
              <Scene region={run.region} theme={th} />
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
  const { runs, base } = useT();
  const run = runs[idx];
  const th = themeFor(run.region);
  return (
    <div className="chapter" style={{ ['--accent' as string]: th.accent }}>
      <header className="chapter-hero">
        <Scene region={run.region} theme={th} />
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
  const { trip, base } = useT();
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
      <p className="foot-link">
        <a href={base}>Back to the journey</a>
      </p>
    </>
  );
}

function DayCard({ day, shared, active }: { day: Day; shared: boolean; active: boolean }) {
  const { staysById, sheet, owner } = useT();
  const stay = day.stayId ? staysById.get(day.stayId) : undefined;
  const shownWarnings = new Set(day.entries.flatMap((e) => e.warnings));
  const todos = shared ? [] : day.todos.filter((td) => !shownWarnings.has(td.text));
  const nothing = day.entries.length === 0 && todos.length === 0;
  return (
    <li className={active ? 'day is-active' : 'day'} id={`day-${day.date}`}>
      <div className="day-head">
        <span className="day-num">{dayOfMonth(day.date)}</span>
        <span className="day-when">
          {weekday(day.date)}
          <small>{monthShort(day.date)}</small>
        </span>
      </div>
      <div className="day-body">
        {day.entries.map((e) => (
          <EntryView key={e.id} entry={e} shared={shared} />
        ))}
        {nothing && <p className="empty">Nothing planned yet.</p>}
        {todos.length > 0 && (
          <ul className="todos">
            {todos.map((td) => (
              <li key={td.id} className={td.warning ? 'todo todo-warn' : 'todo'}>
                {td.text}
              </li>
            ))}
          </ul>
        )}
        {stay && <StayLine stay={stay} date={day.date} shared={shared} />}
        {owner && !shared && sheet[day.date] && <SheetText cells={sheet[day.date]} />}
      </div>
    </li>
  );
}

function StayLine({ stay, date, shared }: { stay: Stay; date: string; shared: boolean }) {
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
    </p>
  );
}

function EntryView({ entry: e, shared }: { entry: Entry; shared: boolean }) {
  const { tracks } = useT();
  const showOnMap = useContext(ShowCtx);
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
        <Links links={e.links} shared={shared} />
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
