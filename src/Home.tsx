import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { listTrips, shareTrip, type TripSummary } from './backend.ts';
import { Icon } from './Icon.tsx';
import { Scene, themeFor } from './scenes.tsx';
import { shortDate } from './derive.ts';

export function Home({ session, signOut }: { session: Session; signOut: () => void }) {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listTrips(session)
      .then((r) => {
        setTrips(r.trips);
        setOffline(r.offline);
      })
      .catch((e) => setError(e?.message ?? 'Could not load your trips.'));
  }, [session]);

  return (
    <div className="home">
      <header className="home-head">
        <span className="wordmark">TraiLilo</span>
        <button type="button" className="chip" onClick={signOut}>Sign out</button>
      </header>
      <h1 className="home-title">Your trips</h1>
      {offline && <p className="offline-note">You’re offline. Showing what’s saved on this phone.</p>}
      {error && <p className="auth-error">{error}</p>}
      {trips && trips.length === 0 && <p className="auth-note">No trips yet. Trips you’re invited to will show up here.</p>}
      <ul className="trip-list">
        {trips?.map((t) => (
          <TripCard key={t.id} t={t} />
        ))}
      </ul>
    </div>
  );
}

function TripCard({ t }: { t: TripSummary }) {
  const th = themeFor(t.cover_region);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <li className="trip-card" style={{ ['--accent' as string]: th.accent }}>
      <a href={`#/trip/${t.id}`} className="trip-card-link">
        <Scene region={t.cover_region} theme={th} photo={false} />
        <div className="trip-card-text">
          <h2>{t.title}</h2>
          {t.start_date && t.end_date && <p>{shortDate(t.start_date)} to {shortDate(t.end_date)}, {t.end_date.slice(0, 4)}</p>}
        </div>
      </a>
      {t.owner && (
        <div className="share">
          <button type="button" className="chip" onClick={() => setOpen(!open)}><Icon name="eye" size={16} /> Share</button>
          {open && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const err = await shareTrip(t.id, email.trim());
                setMsg(err ?? `Shared with ${email.trim()}. They see the friends’ version.`);
                if (!err) setEmail('');
              }}
            >
              <input type="email" required placeholder="friend’s email (they need an account)" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="auth-primary">Share</button>
              {msg && <p className="auth-note small">{msg}</p>}
            </form>
          )}
        </div>
      )}
    </li>
  );
}
