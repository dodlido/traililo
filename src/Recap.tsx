// The trip recap: a cover, the numbers, the route, the moments worth a mention, and each place in turn with what was
// written on a day laid over that day's pictures. Everything is worked out by recap.ts; the pictures load from the
// owner's Google Drive once they have signed in with Google.
import { useEffect, useMemo, useState } from 'react';
import type { DrivePhoto, Point, Trip } from './model.ts';
import { Icon } from './Icon.tsx';
import { connectDrive, driveAvailable, driveConnected, driveLink, pictureBlob, pictureSrc } from './drive.ts';
import { computeRecap, type Moment, type Recap, type RecapChapter, type RecapDay } from './recap.ts';
import { countryName, longDate, monthShort, dayOfMonth, shortDate, weekday } from './derive.ts';
import { themeFor } from './scenes.tsx';

/** A picture from Drive, as a background-ready <img>. Shows nothing until Google is connected. */
function Pic({ photo, ready, size = 900, alt = '' }: { photo?: DrivePhoto; ready: boolean; size?: number; alt?: string }) {
  const [src, setSrc] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setSrc('');
    setTried(false);
    if (!photo || !ready) return;
    let live = true;
    pictureSrc(photo.id, size).then(
      (s) => live && setSrc(s),
      () => live && setSrc(''),
    );
    return () => {
      live = false;
    };
  }, [photo?.id, ready, size]);
  if (!photo || !src) return <span className="recap-blank" aria-hidden="true" />;
  const fallback = () => {
    if (tried) return;
    setTried(true);
    pictureBlob(photo.id).then(setSrc, () => setSrc(''));
  };
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={fallback} />;
}

function Sketch({ route }: { route: Point[] }) {
  if (route.length < 2) return null;
  const lat0 = route.reduce((n, p) => n + p.lat, 0) / route.length;
  const sx = Math.cos((lat0 * Math.PI) / 180);
  const xs = route.map((p) => p.lon * sx);
  const ys = route.map((p) => -p.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = 300;
  const pad = 16;
  const scale = Math.min((w - pad * 2) / Math.max(x1 - x0, 1e-6), (220 - pad * 2) / Math.max(y1 - y0, 1e-6));
  const h = Math.round((y1 - y0) * scale + pad * 2);
  const pts = route.map((_, i) => [pad + (xs[i] - x0) * scale, pad + (ys[i] - y0) * scale] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [sx0, sy0] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className="recap-sketch" viewBox={`0 0 ${w} ${Math.max(h, 60)}`} role="img" aria-label="The route, drawn from the places you slept">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 5" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.2" fill="var(--ice)" opacity="0.8" />
      ))}
      <circle cx={sx0} cy={sy0} r="5" fill="var(--accent)" />
      <circle cx={ex} cy={ey} r="5" fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <dt>{n}</dt>
      <dd>{label}</dd>
    </div>
  );
}

const num = (n: number) => n.toLocaleString('en-GB');

function statTiles(r: Recap): { n: string; label: string }[] {
  const s = r.stats;
  const t: { n: string; label: string; show: boolean }[] = [
    { n: num(s.days), label: s.days === 1 ? 'day' : 'days', show: s.days > 0 },
    { n: num(s.nights), label: s.nights === 1 ? 'night' : 'nights', show: s.nights > 0 },
    { n: num(s.places), label: s.places === 1 ? 'place' : 'places', show: s.places > 1 },
    { n: num(s.countries), label: s.countries === 1 ? 'country' : 'countries', show: s.countries > 1 },
    { n: num(s.hikes), label: s.hikes === 1 ? 'hike' : 'hikes', show: s.hikes > 0 },
    { n: `${num(s.hikeKm)} km`, label: 'on foot', show: s.hikeKm > 0 },
    { n: `${num(s.climbM)} m`, label: 'climbed', show: s.climbM > 0 },
    { n: `${num(s.stopsKm)} km`, label: 'between stops', show: s.stopsKm > 0 },
    { n: num(s.flights + s.ferries), label: s.flights + s.ferries === 1 ? 'flight or ferry' : 'flights and ferries', show: s.flights + s.ferries > 0 },
    { n: num(s.photos), label: s.photos === 1 ? 'picture' : 'pictures', show: s.photos > 0 },
    { n: num(s.written), label: s.written === 1 ? 'day written' : 'days written', show: s.written > 0 },
  ];
  return t.filter((x) => x.show);
}

/** One day: the journal line laid over the day's first picture, with the rest of the day's pictures beneath. */
function DayStory({ rd, ready }: { rd: RecapDay; ready: boolean }) {
  const { day, photos, snippet } = rd;
  const hero = photos[Math.floor((photos.length - 1) / 2)];
  const rest = photos.filter((p) => p !== hero);
  const head = `${weekday(day.date)} ${shortDate(day.date)}`;
  if (!hero && !snippet) return null;
  return (
    <article className="recap-day">
      {hero ? (
        <a className="recap-shot" href={driveLink(hero.id)} target="_blank" rel="noopener noreferrer" aria-label={`Open the picture from ${head} in Google Drive`}>
          <Pic photo={hero} ready={ready} size={1000} />
          <span className="recap-date">{head}</span>
          {snippet && <p>{snippet}</p>}
        </a>
      ) : (
        <div className="recap-note">
          <span className="recap-date">{head}</span>
          <p>{snippet}</p>
        </div>
      )}
      {rest.length > 0 && (
        <div className="recap-more">
          {rest.slice(0, 5).map((p) => (
            <a key={p.id} href={driveLink(p.id)} target="_blank" rel="noopener noreferrer" aria-label="Open the picture in Google Drive">
              <Pic photo={p} ready={ready} size={400} />
            </a>
          ))}
          {rest.length > 5 && <span className="recap-count">+{rest.length - 5}</span>}
        </div>
      )}
    </article>
  );
}

function ChapterStory({ ch, ready }: { ch: RecapChapter; ready: boolean }) {
  const th = themeFor(ch.run.region);
  const first = ch.days[0].day.date;
  const last = ch.days[ch.days.length - 1].day.date;
  const facts = [ch.days.length === 1 ? '1 day' : `${ch.days.length} days`, ch.hikeKm > 0 ? `${ch.hikeKm} km on foot` : '', ch.photos > 0 ? `${ch.photos} ${ch.photos === 1 ? 'picture' : 'pictures'}` : ''].filter(Boolean);
  return (
    <section className="recap-chapter" style={{ ['--accent' as string]: th.accent }}>
      <header>
        <Pic photo={ch.cover} ready={ready} size={1000} />
        <div>
          <h3>{ch.run.region}</h3>
          <p>
            {ch.run.country ? `${countryName[ch.run.country]} · ` : ''}
            {shortDate(first)}
            {last !== first ? ` to ${shortDate(last)}` : ''}
          </p>
          <p className="recap-facts">{facts.join(' · ')}</p>
        </div>
      </header>
      {ch.days.map((rd) => (
        <DayStory key={rd.day.date} rd={rd} ready={ready} />
      ))}
    </section>
  );
}

export function RecapView({ trip, title, canEdit, mutate, go }: { trip: Trip; title: string; canEdit: boolean; mutate: (fn: (t: Trip) => void) => Promise<void>; go: (h: string) => void }) {
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const r = useMemo(() => computeRecap(trip), [trip]);
  const ready = driveConnected();
  const needSignIn = driveAvailable() && !ready && r.stats.photos > 0;
  const connect = async () => {
    setBusy(true);
    setErr('');
    try {
      await connectDrive();
      tick((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong with Google.');
    }
    setBusy(false);
  };
  const setHidden = (key: string, hide: boolean) =>
    void mutate((t) => {
      const s = new Set(t.recapHidden ?? []);
      if (hide) s.add(key);
      else s.delete(key);
      if (s.size) t.recapHidden = [...s];
      else delete t.recapHidden;
    });
  const dates = `${monthShort(trip.startDate)} ${dayOfMonth(trip.startDate)} to ${monthShort(trip.endDate)} ${dayOfMonth(trip.endDate)}, ${trip.endDate.slice(0, 4)}`;
  const tiles = statTiles(r);
  const row = (m: Moment, hidden: boolean) => (
    <li key={m.key}>
      <span className="recap-ico">
        <Icon name={m.icon} size={20} />
      </span>
      <div>
        <b>{m.title}</b>
        <span>{m.detail}</span>
      </div>
      <time dateTime={m.date}>{shortDate(m.date)}</time>
      {canEdit && (
        <button type="button" className="recap-hide" aria-label={hidden ? `Put “${m.title}” back in the recap` : `Leave “${m.title}” out of the recap`} onClick={() => setHidden(m.key, !hidden)}>
          {hidden ? 'Put back' : 'Leave out'}
        </button>
      )}
    </li>
  );

  return (
    <div className="recap">
      <header className="recap-hero">
        <Pic photo={r.cover} ready={ready} size={1400} />
        <div className="recap-top">
          <button type="button" className="round" aria-label="Back to the journey" onClick={() => go('')}>
            <Icon name="back" size={22} />
          </button>
          <span className="wordmark">TraiLilo</span>
        </div>
        <div className="recap-title">
          <p className="eyebrow">{r.state === 'during' ? `Recap so far · day ${r.stats.days}` : 'Recap'}</p>
          <h1>{title}</h1>
          <p className="cover-sub">{dates}</p>
        </div>
      </header>

      {r.state === 'before' ? (
        <p className="recap-empty">The recap starts on day one ({longDate(trip.startDate)}). Until then there is nothing to look back on.</p>
      ) : (
        <>
          {needSignIn && (
            <div className="recap-signin">
              <button type="button" className="add-btn" disabled={busy} onClick={() => void connect()}>
                <Icon name="image" size={18} /> {busy ? 'Connecting…' : 'Show pictures (sign in with Google)'}
              </button>
              {err && <p role="status" className="hint">{err}</p>}
            </div>
          )}

          {tiles.length > 0 && (
            <dl className="recap-stats" aria-label="The trip in numbers">
              {tiles.map((t) => (
                <Stat key={t.label} n={t.n} label={t.label} />
              ))}
            </dl>
          )}

          {r.route.length > 1 && (
            <section className="recap-route" aria-label="The route">
              <Sketch route={r.route} />
              <button type="button" className="chip" onClick={() => go('map')}>
                <Icon name="map" size={16} /> See it on the map
              </button>
            </section>
          )}

          {(r.moments.length > 0 || r.hidden.length > 0) && (
            <section className="recap-moments" aria-label="Highlights">
              <h2>Highlights</h2>
              {r.moments.length > 0 && <ul>{r.moments.map((m) => row(m, false))}</ul>}
              {canEdit && r.hidden.length > 0 && (
                <>
                  <button type="button" className="recap-left-out" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                    {open ? 'Hide' : 'Show'} {r.hidden.length} left out
                  </button>
                  {open && <ul className="is-hidden">{r.hidden.map((m) => row(m, true))}</ul>}
                </>
              )}
            </section>
          )}

          {r.chapters.map((ch) => (
            <ChapterStory key={ch.idx} ch={ch} ready={ready} />
          ))}
          {r.stats.photos === 0 && <p className="recap-empty">Add pictures from Google Photos on a day and they appear here, with what you wrote that day laid over them.</p>}
        </>
      )}
    </div>
  );
}
