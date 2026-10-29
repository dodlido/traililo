import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { TripApp } from './App.tsx';
import { Gate } from './Gate.tsx';
import { Home } from './Home.tsx';
import { loadTrip, type Bundle } from './backend.ts';
import { COVER, Scene } from './scenes.tsx';
import './styles.css';

function TripLoader({ session, id, sub }: { session: Session; id: string; sub: string }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBundle(null);
    loadTrip(session, id).then((r) => setBundle(r.bundle)).catch((e) => setError(e?.message ?? 'Could not open this trip.'));
  }, [session.user.id, id]);
  if (error) return <div className="auth"><main className="auth-card"><p className="auth-error">{error}</p><a className="auth-link" href="#/">Back to your trips</a></main></div>;
  if (!bundle) return <div className="auth"><Scene region="TraiLilo" theme={COVER} seed="cover" photo={false} className="auth-scene" /><main className="auth-card"><p className="auth-note">Opening your trip…</p></main></div>;
  return <TripApp bundle={bundle} base={`#/trip/${id}`} sub={sub} />;
}

function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return (
    <Gate>
      {(session, signOut) => {
        const m = /^#\/trip\/([0-9a-fA-F-]{36})(\/.*)?$/.exec(hash);
        return m ? <TripLoader session={session} id={m[1]} sub={m[2] ?? ''} /> : <Home session={session} signOut={signOut} />;
      }}
    </Gate>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
