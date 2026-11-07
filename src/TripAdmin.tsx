import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { deleteTrip, listMembers, shareTrip, unshareTrip } from './backend.ts';

/** Who else can edit this trip. Lives in Trip settings (edit mode), not on the home screen. */
export function Partners({ tripId }: { tripId: string }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [members, setMembers] = useState<{ email: string; role: 'partner' }[] | null>(null);
  const refresh = () => listMembers(tripId).then(setMembers).catch((e) => setMsg(e instanceof Error ? e.message : 'Could not load who has access.'));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);
  return (
    <section className="admin-block" aria-label="Travel partners">
      <h3>Travel partners</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const who = email.trim();
          const err = await shareTrip(tripId, who);
          setMsg(err ?? `${who} is now a travel partner and can edit everything.`);
          if (!err) {
            setEmail('');
            void refresh();
          }
        }}
      >
        <input type="email" required placeholder="their email (they need an account)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="hint">A travel partner sees and edits everything, including bookings, notes and journal.</p>
        <button className="auth-primary">Add</button>
        {msg && <p className="auth-note small" role="status">{msg}</p>}
      </form>
      {members && members.length > 0 && (
        <ul className="members">
          {members.map((m) => (
            <li key={m.email}>
              <span>{m.email}</span>
              <em>travel partner</em>
              <button
                type="button"
                className="chip"
                onClick={async () => {
                  const err = await unshareTrip(tripId, m.email);
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
    </section>
  );
}

/** Deleting a whole trip, behind a second tap. */
export function DeleteTrip({ session, tripId, title, onDeleted }: { session: Session; tripId: string; title: string; onDeleted: () => void }) {
  const [sure, setSure] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="admin-block" aria-label="Delete trip">
      {!sure ? (
        <button type="button" className="chip danger" onClick={() => setSure(true)}>Delete trip</button>
      ) : (
        <div className="delete-confirm" role="alertdialog" aria-label={`Delete ${title}`}>
          <p>
            <b>Delete “{title}” for good?</b> Every day, booking, note and journal entry goes, and so does everyone’s access. This cannot be undone. Pictures in your Google Drive are not touched.
          </p>
          {err && <p className="auth-error">{err}</p>}
          <div className="row">
            <button
              type="button"
              className="chip danger"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                setErr(null);
                try {
                  await deleteTrip(session, tripId);
                  onDeleted();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : 'Could not delete the trip.');
                  setDeleting(false);
                }
              }}
            >
              {deleting ? 'Deleting…' : 'Yes, delete it'}
            </button>
            <button type="button" className="chip" disabled={deleting} onClick={() => { setSure(false); setErr(null); }}>Keep it</button>
          </div>
        </div>
      )}
    </section>
  );
}
