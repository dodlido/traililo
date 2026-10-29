// The front door: sign in with email and password, then a 6-digit code from an authenticator app.
// Nothing from a trip is requested until both steps are done, and the database refuses to hand it over before that anyway.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { NEEDS_NEW_PASSWORD, clearCache, sb } from './backend.ts';
import { configured } from './config.ts';
import { COVER, Scene } from './scenes.tsx';

type Stage = 'loading' | 'login' | 'setpw' | 'enroll' | 'verify' | 'ready';

export function Gate({ children }: { children: (session: Session, signOut: () => void) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const mustSetPassword = useRef(NEEDS_NEW_PASSWORD);

  async function decide(s: Session | null) {
    setSession(s);
    if (!s) return setStage('login');
    if (mustSetPassword.current) return setStage('setpw');
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel === 'aal2') setStage('ready');
    else if (data?.nextLevel === 'aal2') setStage('verify');
    else setStage('enroll');
  }

  useEffect(() => {
    if (!configured) return;
    sb.auth.getSession().then(({ data }) => decide(data.session));
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') mustSetPassword.current = true;
      // refreshing a token must not bounce someone out of a screen they are in the middle of
      if (event === 'TOKEN_REFRESHED' && s) return setSession(s);
      setTimeout(() => decide(s), 0);
    });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    clearCache();
    await sb.auth.signOut();
  };

  if (!configured) return <Frame title="Almost there"><p className="auth-note">TraiLilo isn’t connected to its database yet. Add your Supabase address and key in <code>src/config.ts</code> and rebuild.</p></Frame>;
  if (stage === 'loading') return <Frame><p className="auth-note">One moment…</p></Frame>;
  if (stage === 'login') return <Login />;
  if (stage === 'setpw') return <SetPassword onDone={() => { mustSetPassword.current = false; decide(session); }} />;
  if (stage === 'enroll') return <Enroll onDone={() => decide(session)} onCancel={signOut} />;
  if (stage === 'verify') return <Verify onDone={() => decide(session)} onCancel={signOut} />;
  return <>{session && children(session, signOut)}</>;
}

function Frame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="auth">
      <Scene region="TraiLilo" theme={COVER} seed="cover" photo={false} className="auth-scene" />
      <main className="auth-card">
        <span className="wordmark">TraiLilo</span>
        {title && <h1>{title}</h1>}
        {children}
      </main>
    </div>
  );
}

function useSubmit(fn: () => Promise<string | null>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setError(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
    setBusy(false);
  };
  return { busy, error, setError, submit };
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, setError, submit } = useSubmit(async () => {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    return error ? 'That email and password don’t match.' : null;
  });
  async function forgot() {
    if (!email.trim()) return setError('Type your email first, then tap “Forgot password”.');
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    if (error) setError(error.message);
    else setSent(true);
  }
  return (
    <Frame title="Welcome back">
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {sent && <p className="auth-note">If that email has an account, a reset link is on its way.</p>}
        <button className="auth-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="auth-link" onClick={forgot}>Forgot password</button>
      </form>
      <p className="auth-note small">Private journal. Access is by invitation only.</p>
    </Frame>
  );
}

function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    if (pw.length < 10) return 'Use at least 10 characters.';
    if (pw !== pw2) return 'The two passwords differ.';
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return error.message;
    onDone();
    return null;
  });
  return (
    <Frame title="Choose a password">
      <form onSubmit={submit}>
        <label>New password<input type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Repeat it<input type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-primary" disabled={busy}>Save password</button>
      </form>
    </Frame>
  );
}

function CodeField({ code, setCode }: { code: string; setCode: (v: string) => void }) {
  return (
    <label>
      6-digit code
      <input className="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
    </label>
  );
}

function Enroll({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: list } = await sb.auth.mfa.listFactors();
      // an earlier, unfinished setup would block a new one
      for (const f of list?.all ?? []) if (f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `TraiLilo ${Date.now()}` });
      if (!alive) return;
      if (error || !data) setLoadError(error?.message ?? 'Could not start two-step setup.');
      else setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      alive = false;
    };
  }, []);
  const { busy, error, submit } = useSubmit(async () => {
    if (!factor) return null;
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) return 'That code didn’t work. Check the time on your phone and try the next one.';
    onDone();
    return null;
  });
  return (
    <Frame title="Set up two-step sign-in">
      <p className="auth-note">Scan this with an authenticator app (Google Authenticator, 1Password, Authy…), then type the 6-digit code it shows.</p>
      {loadError && <p className="auth-error">{loadError}</p>}
      {factor && (
        <form onSubmit={submit}>
          <img className="qr" src={factor.qr} alt="QR code for your authenticator app" width="180" height="180" />
          <p className="auth-note small">Can’t scan? Enter this key instead:<br /><code>{factor.secret}</code></p>
          <CodeField code={code} setCode={setCode} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-primary" disabled={busy}>Turn on</button>
        </form>
      )}
      <button type="button" className="auth-link" onClick={onCancel}>Sign out</button>
    </Frame>
  );
}

function Verify({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const { data: list } = await sb.auth.mfa.listFactors();
    const f = list?.totp?.[0];
    if (!f) return 'No authenticator is set up for this account.';
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    if (error) return 'That code didn’t work. Try the next one.';
    onDone();
    return null;
  });
  return (
    <Frame title="Your code">
      <form onSubmit={submit}>
        <p className="auth-note">Open your authenticator app and enter the current 6-digit code.</p>
        <CodeField code={code} setCode={setCode} />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-primary" disabled={busy}>Continue</button>
      </form>
      <button type="button" className="auth-link" onClick={onCancel}>Sign out</button>
    </Frame>
  );
}
