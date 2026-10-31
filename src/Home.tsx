import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createTrip, deleteTrip, fresh, listMembers, listTrips, shareTrip, unshareTrip, type TripSummary } from './backend.ts';
import type { Day, Trip } from './model.ts';
import { Icon } from './Icon.tsx';
import { HomeSetting } from './Edit.tsx';
import { THEMES, Scene, themeFor } from './scenes.tsx';
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
      <NewTrip />
      <HomeSetting />
      <ul className="trip-list">
        {trips?.map((t) => (
          <TripCard key={t.id} t={t} session={session} onDeleted={() => setTrips((l) => (l ? l.filter((x) => x.id !== t.id) : l))} />
        ))}
      </ul>
    </div>
  );
}

function TripCard({ t, session, onDeleted }: { t: TripSummary; session: Session; onDeleted: () => void }) {
  const th = themeFor(t.cover_region);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'friend' | 'partner'>('friend');
  const [msg, setMsg] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [members, setMembers] = useState<{ email: string; role: 'friend' | 'partner' }[] | null>(null);
  const refresh = () => listMembers(t.id).then(setMembers).catch((e) => setMsg(e instanceof Error ? e.message : 'Could not load who has access.'));
  useEffect(() => {
    if (open && t.role === 'owner') void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <li className="trip-card" style={{ ['--accent' as string]: th.accent }}>
      <a href={`#/trip/${t.id}`} className="trip-card-link">
        <Scene region={t.cover_region} theme={th} photo={false} />
        <div className="trip-card-text">
          <h2>{t.title}</h2>
          {t.start_date && t.end_date && <p>{shortDate(t.start_date)} to {shortDate(t.end_date)}, {t.end_date.slice(0, 4)}</p>}
          {t.role === 'partner' && <p className="role-tag">You’re a travel partner: you can edit everything</p>}
          {t.role === 'friend' && <p className="role-tag">Shared with you to view</p>}
        </div>
      </a>
      {t.role === 'owner' && (
        <div className="share">
          <button type="button" className="chip" onClick={() => setOpen(!open)}><Icon name="eye" size={16} /> Share</button>
          {open && (
            <>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const who = email.trim();
                  const err = await shareTrip(t.id, who, role);
                  setMsg(err ?? (role === 'partner' ? `${who} is now a travel partner and can edit everything.` : `Shared with ${who}. They see the friends’ version.`));
                  if (!err) {
                    setEmail('');
                    void refresh();
                  }
                }}
              >
                <input type="email" required placeholder="their email (they need an account)" value={email} onChange={(e) => setEmail(e.target.value)} />
                <div className="role-pick" role="radiogroup" aria-label="What they can do">
                  <label><input type="radio" name={`r-${t.id}`} checked={role === 'friend'} onChange={() => setRole('friend')} /> <b>Friend</b> sees the friends’ version, read-only</label>
                  <label><input type="radio" name={`r-${t.id}`} checked={role === 'partner'} onChange={() => setRole('partner')} /> <b>Travel partner</b> sees and edits everything, including bookings, notes and journal</label>
                </div>
                <button className="auth-primary">Share</button>
                {msg && <p className="auth-note small">{msg}</p>}
              </form>
              {members && members.length > 0 && (
                <ul className="members">
                  {members.map((m) => (
                    <li key={m.email}>
                      <span>{m.email}</span>
                      <em>{m.role === 'partner' ? 'travel partner' : 'friend'}</em>
                      <button
                        type="button"
                        className="chip"
                        onClick={async () => {
                          const err = await unshareTrip(t.id, m.email);
                          setMsg(err ?? `${m.email} no longer has access.`);
                          void refresh();
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {!sure ? (
            <button type="button" className="chip danger" onClick={() => setSure(true)}>Delete trip</button>
          ) : (
            <div className="delete-confirm" role="alertdialog" aria-label={`Delete ${t.title}`}>
              <p>
                <b>Delete “{t.title}” for good?</b> Every day, booking, note and journal entry goes, and so does everyone’s access. This cannot be undone. Pictures in your Google Drive are not touched.
              </p>
              {delErr && <p className="auth-error">{delErr}</p>}
              <div className="row">
                <button
                  type="button"
                  className="chip danger"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    setDelErr(null);
                    try {
                      await deleteTrip(session, t.id);
                      onDeleted();
                    } catch (e) {
                      setDelErr(e instanceof Error ? e.message : 'Could not delete the trip.');
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? 'Deleting…' : 'Yes, delete it'}
                </button>
                <button type="button" className="chip" disabled={deleting} onClick={() => { setSure(false); setDelErr(null); }}>Keep it</button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function NewTrip() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [cover, setCover] = useState('Torres del Paine');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !start || !end) return setErr('Fill in a name and both dates.');
    if (end < start) return setErr('The end date is before the start.');
    const dates: string[] = [];
    for (let d = new Date(start + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= end && dates.length < 150; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
    const days: Day[] = dates.map((date) => ({ date, region: title.trim(), entries: [], todos: [] }));
    const trip = { id: crypto.randomUUID(), title: title.trim(), startDate: start, endDate: end, days, stays: [] } as unknown as Trip;
    setBusy(true);
    setErr(null);
    try {
      const id = await createTrip(title.trim(), cover, trip);
      fresh.id = id;
      location.hash = `#/trip/${id}`;
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not create the trip.');
    }
    setBusy(false);
  }
  if (!open)
    return (
      <p className="new-trip">
        <button type="button" className="add-btn" onClick={() => setOpen(true)}>
          <Icon name="plus" size={18} /> New trip
        </button>
      </p>
    );
  return (
    <form className="new-trip-form" onSubmit={create}>
      <label>Trip name<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Madeira, Japan, Dolomites…" autoFocus /></label>
      <div className="two">
        <label>From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <label>Cover look<select value={cover} onChange={(e) => setCover(e.target.value)}>{Object.keys(THEMES).map((k) => <option key={k}>{k}</option>)}</select></label>
      {err && <p className="auth-error">{err}</p>}
      <div className="row">
        <button className="auth-primary" disabled={busy}>{busy ? 'Creating…' : 'Create trip'}</button>
        <button type="button" className="chip" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
