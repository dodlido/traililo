// "Save for the trip": keeps the map along the route, and the pictures, on the phone for places with no signal.
import { useEffect, useMemo, useState } from 'react';
import type { Trip } from './model.ts';
import type { Tracks } from './MapView.tsx';
import { imageList, savedKey, tileList, type BaseId } from './offline.ts';

interface Saved {
  at: string;
  count: number;
  bad: number;
}
const BASES: { id: BaseId; label: string }[] = [
  { id: 'west', label: 'Old West' },
  { id: 'dark', label: 'Dark' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'satellite', label: 'Satellite' },
];
const read = (b: BaseId): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(savedKey(b)) ?? 'null');
  } catch {
    return null;
  }
};
const startBase = (): BaseId => {
  try {
    const v = localStorage.getItem('traililo:base2');
    if (v === 'terrain' || v === 'satellite' || v === 'dark') return v;
  } catch {
    /* default */
  }
  return 'west';
};

export function OfflineCard({ trip, tracks }: { trip: Trip; tracks: Tracks }) {
  const [base, setBase] = useState<BaseId>(startBase);
  const [saved, setSaved] = useState<Saved | null>(() => read(startBase()));
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const supported = 'serviceWorker' in navigator && 'caches' in window;
  const plan = useMemo(() => tileList(trip, tracks, base), [trip, tracks, base]);
  const images = useMemo(() => imageList(trip), [trip]);
  useEffect(() => setSaved(read(base)), [base]);
  useEffect(() => {
    if (!supported) return;
    const f = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'progress') setProg({ done: d.done, total: d.total });
      if (d.type === 'done') {
        const s = { at: new Date().toISOString().slice(0, 10), count: d.total, bad: d.bad };
        try {
          localStorage.setItem(savedKey(base), JSON.stringify(s));
        } catch {
          /* fine */
        }
        setSaved(s);
        setProg(null);
        if (d.bad > d.total / 4) setError('Many pictures or map pieces did not download. Try again with a better connection.');
      }
      if (d.type === 'forgotten') {
        try {
          for (const b of BASES) localStorage.removeItem(savedKey(b.id));
        } catch {
          /* fine */
        }
        setSaved(null);
      }
    };
    navigator.serviceWorker.addEventListener('message', f);
    return () => navigator.serviceWorker.removeEventListener('message', f);
  }, [supported, base]);
  if (!supported) return null;
  const start = async () => {
    setError('');
    if (!navigator.onLine) return setError('You need signal to save things. Try again with wifi.');
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active) throw new Error('not ready');
      void navigator.storage?.persist?.();
      setProg({ done: 0, total: plan.urls.length + images.length });
      reg.active.postMessage({ type: 'save', tiles: plan.urls, images });
    } catch {
      setProg(null);
      setError('Saving is not ready yet. Close the app, open it again, and try once more.');
    }
  };
  const forget = async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'forget' });
  };
  const busy = prog !== null;
  return (
    <section className="offline-card" aria-label="Save for offline">
      <h2>No signal on the trail?</h2>
      <p>
        {saved
          ? `Map and pictures saved on this phone (${saved.at}). The trip itself also opens without signal.`
          : `Save the map along your route and the pictures. About ${plan.estimateMb} MB, best done on wifi. The trip itself already opens without signal.`}
      </p>
      <div className="offline-row" role="radiogroup" aria-label="Map style to save">
        {BASES.map((b) => (
          <button key={b.id} type="button" role="radio" aria-checked={base === b.id} className={base === b.id ? 'chip is-on' : 'chip'} disabled={busy} onClick={() => setBase(b.id)}>
            {b.label}
            {read(b.id) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      {busy && (
        <div className="offline-bar" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
          <i style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="offline-row">
        <button type="button" className="chip solid" disabled={busy} onClick={start}>
          {busy ? `Saving… ${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` : saved ? 'Save again' : 'Save for offline'}
        </button>
        {saved && !busy && (
          <button type="button" className="chip" onClick={forget}>
            Remove saved map
          </button>
        )}
      </div>
    </section>
  );
}
