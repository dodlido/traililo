// The owner's planning page: what still has to be booked, the weather for each place, and what to pack.
import { useEffect, useMemo, useState } from 'react';
import type { Trip } from './model.ts';
import { regionRuns, shortDate, weekday } from './derive.ts';
import { Icon } from './Icon.tsx';
import { todayDate } from './today.ts';
import { adviceFor, placePoint, weatherFor, type WeatherByDate } from './weather.ts';
import { makePacking } from './packing.ts';
import { applyRoutes, roadJobs, routeJob } from './autoroute.ts';

type Mutate = (fn: (t: Trip) => void) => Promise<void>;

interface Item {
  key: string;
  date: string;
  text: string;
  warn?: boolean;
  todo?: string; // id of a real to-do (can be ticked)
  done?: boolean;
  stay?: boolean;
}

/** Everything still to arrange, in date order: open to-dos, booking warnings, and nights with no place booked. */
export function bookingItems(trip: Trip): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const d of trip.days) {
    for (const td of d.todos) {
      seen.add(d.date + td.text);
      out.push({ key: td.id, date: d.date, text: td.text, warn: td.warning, todo: td.id, done: td.done });
    }
    for (const e of d.entries) {
      for (const w of e.warnings) {
        if (seen.has(d.date + w)) continue;
        seen.add(d.date + w);
        out.push({ key: `${e.id}-w-${w}`, date: d.date, text: `${e.title}: ${w}`, warn: true });
      }
    }
  }
  for (const s of trip.stays) {
    if (s.assumed || s.nameIsPlaceholder || (!s.booking && !/refugio|camp/.test(s.type))) {
      out.push({ key: `stay-${s.id}`, date: s.checkIn, text: `Book somewhere to sleep: ${s.name}${s.location ? `, ${s.location}` : ''} (${s.nights} night${s.nights === 1 ? '' : 's'})`, stay: true, warn: true });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function Plan({ trip, mutate, openDay, base }: { trip: Trip; mutate: Mutate; openDay: (date: string) => void; base: string }) {
  return (
    <>
      <header className="page-head">
        <h1>Plan</h1>
        <p className="page-sub">Only you see this page.</p>
      </header>
      <BookSection trip={trip} mutate={mutate} openDay={openDay} />
      <RoadSection trip={trip} mutate={mutate} />
      <WeatherSection trip={trip} />
      <PackSection trip={trip} mutate={mutate} />
      <p className="foot-link">
        <a href={base}>Back to the journey</a>
      </p>
    </>
  );
}

function BookSection({ trip, mutate, openDay }: { trip: Trip; mutate: Mutate; openDay: (d: string) => void }) {
  const items = useMemo(() => bookingItems(trip), [trip]);
  const [showDone, setShowDone] = useState(false);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const byDate = new Map<string, Item[]>();
  for (const i of open) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i]);
  const toggle = (i: Item) =>
    mutate((t) => {
      const x = t.days.flatMap((d) => d.todos).find((q) => q.id === i.todo);
      if (x) x.done = !x.done;
    });
  return (
    <section className="plan-block" aria-labelledby="plan-book">
      <h2 id="plan-book">What to book</h2>
      <p className="plan-note">{open.length === 0 ? 'Nothing left to arrange.' : `${open.length} thing${open.length === 1 ? '' : 's'} still to sort out, in date order.`}</p>
      {[...byDate].map(([date, list]) => (
        <div className="plan-day" key={date}>
          <button type="button" className="plan-date" onClick={() => openDay(date)}>
            {weekday(date)} {shortDate(date)} <Icon name="next" size={14} />
          </button>
          <ul className="todos">
            {list.map((i) => (
              <li key={i.key} className={`${i.warn ? 'todo todo-warn' : 'todo'}`}>
                {i.todo ? (
                  <label>
                    <input type="checkbox" checked={!!i.done} onChange={() => toggle(i)} />
                    <span>{i.text}</span>
                  </label>
                ) : (
                  <label className="no-box">
                    <Icon name={i.stay ? 'bed' : 'flag'} size={18} />
                    <span>{i.text}</span>
                  </label>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {done.length > 0 && (
        <>
          <button type="button" className="link-btn" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide' : 'Show'} {done.length} done
          </button>
          {showDone && (
            <ul className="todos">
              {done.map((i) => (
                <li key={i.key} className="todo is-done">
                  <label>
                    <input type="checkbox" checked onChange={() => toggle(i)} />
                    <span>
                      {shortDate(i.date)}: {i.text}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function WeatherSection({ trip }: { trip: Trip }) {
  const runs = useMemo(() => regionRuns(trip), [trip]);
  const [wx, setWx] = useState<Record<string, WeatherByDate>>({});
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const today = todayDate();
    (async () => {
      const got: Record<string, WeatherByDate> = {};
      await Promise.all(
        runs.map(async (r) => {
          const dates = r.days.map((d) => d.date);
          const p = placePoint(trip, dates);
          if (!p) return;
          got[r.region + dates[0]] = await weatherFor(p.lat, p.lon, dates, today);
        }),
      );
      if (!live) return;
      setWx(got);
      setFailed(Object.values(got).every((g) => Object.keys(g).length === 0));
    })();
    return () => {
      live = false;
    };
  }, [runs, trip]);
  return (
    <section className="plan-block" aria-labelledby="plan-wx">
      <h2 id="plan-wx">Weather by place</h2>
      <p className="plan-note">A forecast once a stay is within about two weeks. Before then, this shows what the same dates were like last year.</p>
      {failed && <p className="plan-note">No weather could be loaded right now. It shows again when you have signal.</p>}
      <ul className="wx-list">
        {runs.map((r) => {
          const w = wx[r.region + r.days[0].date] ?? {};
          const list = r.days.map((d) => w[d.date]).filter(Boolean);
          if (!list.length) return (
            <li key={r.region + r.days[0].date} className="wx-card">
              <b>{r.region}</b>
              <span className="meta">{shortDate(r.days[0].date)}{r.days.length > 1 ? ` to ${shortDate(r.days[r.days.length - 1].date)}` : ''}</span>
            </li>
          );
          const lo = Math.min(...list.map((x) => x.lo));
          const hi = Math.max(...list.map((x) => x.hi));
          const wet = list.filter((x) => x.rain >= 2).length;
          const tips = adviceFor(list);
          return (
            <li key={r.region + r.days[0].date} className="wx-card">
              <div className="wx-top">
                <b>{r.region}</b>
                <span className="meta">
                  {shortDate(r.days[0].date)}
                  {r.days.length > 1 ? ` to ${shortDate(r.days[r.days.length - 1].date)}` : ''}
                </span>
              </div>
              <p className="wx-nums">
                {lo}° to {hi}° · rain on {wet} of {list.length} day{list.length === 1 ? '' : 's'} · gusts up to {Math.max(...list.map((x) => x.wind))} km/h
              </p>
              <p className="wx-src">{list[0].kind === 'forecast' ? 'Forecast' : 'Same dates last year'}</p>
              {tips.length > 0 && (
                <ul className="wx-tips">
                  {tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PackSection({ trip, mutate }: { trip: Trip; mutate: Mutate }) {
  const [text, setText] = useState('');
  const list = trip.packing ?? [];
  const groups = [...new Set(list.map((p) => p.group))];
  const left = list.filter((p) => !p.done).length;
  return (
    <section className="plan-block" aria-labelledby="plan-pack">
      <h2 id="plan-pack">Packing</h2>
      {list.length === 0 ? (
        <>
          <p className="plan-note">A starting list made from the hikes, boats, flights and stays in this trip. Change anything you like afterwards.</p>
          <button type="button" className="chip solid" onClick={() => mutate((t) => { t.packing = makePacking(t); })}>
            <Icon name="spark" size={16} /> Make a packing list
          </button>
        </>
      ) : (
        <>
          <p className="plan-note">{left === 0 ? 'Everything is packed.' : `${left} of ${list.length} still to pack.`} These are suggestions, so check them against your own gear.</p>
          {groups.map((g) => (
            <div key={g} className="pack-group">
              <h3>{g}</h3>
              <ul className="todos">
                {list.filter((p) => p.group === g).map((p) => (
                  <li key={p.id} className={`todo${p.done ? ' is-done' : ''}`}>
                    <label>
                      <input type="checkbox" checked={p.done} onChange={() => mutate((t) => { const x = t.packing?.find((q) => q.id === p.id); if (x) x.done = !x.done; })} />
                      <span>{p.text}</span>
                    </label>
                    <button type="button" className="round small" aria-label={`Remove ${p.text}`} onClick={() => mutate((t) => { t.packing = t.packing?.filter((q) => q.id !== p.id); })}>
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <form
            className="pack-add"
            onSubmit={(ev) => {
              ev.preventDefault();
              const v = text.trim();
              if (!v) return;
              setText('');
              mutate((t) => { (t.packing ??= []).push({ id: `p${Math.random().toString(36).slice(2, 8)}`, group: 'Extras', text: v, done: false }); });
            }}
          >
            <input placeholder="Add something to pack" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="chip">Add</button>
          </form>
          <button type="button" className="link-btn" onClick={() => mutate((t) => { for (const p of t.packing ?? []) p.done = false; })}>
            Untick everything
          </button>
        </>
      )}
    </section>
  );
}

function RoadSection({ trip, mutate }: { trip: Trip; mutate: Mutate }) {
  const jobs = useMemo(() => roadJobs(trip), [trip]);
  const [prog, setProg] = useState<number | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  if (jobs.length === 0 && !msg) return null;
  const go = async () => {
    setFailed([]);
    setMsg('');
    const found: { job: (typeof jobs)[number]; r: Awaited<ReturnType<typeof routeJob>> }[] = [];
    const bad: string[] = [];
    for (let i = 0; i < jobs.length; i++) {
      setProg(i);
      try {
        const r = await routeJob(jobs[i]);
        found.push({ job: jobs[i], r });
        if (!r) bad.push(jobs[i].label);
      } catch {
        bad.push(jobs[i].label);
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    setProg(null);
    setFailed(bad);
    if (found.length) await mutate((t) => applyRoutes(t, found)).catch(() => {});
    setMsg(`${found.filter((f) => f.r).length} drawn on real roads and water lines${bad.length ? `, ${bad.length} not found` : ''}.`);
  };
  return (
    <section className="plan-block" aria-labelledby="plan-roads">
      <h2 id="plan-roads">Routes on roads and water</h2>
      <p className="plan-note">{jobs.length > 0 ? `${jobs.length} bus, car or ferry leg${jobs.length === 1 ? ' is' : 's are'} drawn as a straight line. This finds the real road, or the charted ferry line. It needs signal and takes a minute.` : msg}</p>
      {jobs.length > 0 && (
        <button type="button" className="chip solid" disabled={prog !== null} onClick={go}>
          {prog !== null ? `Finding routes… ${prog + 1} of ${jobs.length}` : 'Find them'}
        </button>
      )}
      {jobs.length > 0 && msg && <p className="plan-note">{msg}</p>}
      {failed.length > 0 && <p className="plan-note">Nothing found for: {failed.join('; ')}. They stay as straight lines.</p>}
    </section>
  );
}
