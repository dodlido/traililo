// The bar shown while changes made on this phone have not reached the database (no signal), or when the trip was
// also changed on another device and the two versions have to be reconciled.
import { useState } from 'react';

export type SyncState = 'ok' | 'pending' | 'conflict';

export function SyncBar({ state, onRetry, onKeepMine, onUseTheirs, onSaveFile }: { state: SyncState; onRetry: () => void; onKeepMine: () => Promise<void>; onUseTheirs: () => Promise<void>; onSaveFile: () => void }) {
  const [armed, setArmed] = useState<'mine' | 'theirs' | null>(null);
  const [busy, setBusy] = useState(false);
  if (state === 'ok') return null;
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
      setArmed(null);
    }
  };
  if (state === 'pending') {
    return (
      <div className="sync-bar" role="status">
        <span>Not uploaded yet. Your changes are kept on this phone and upload when you have signal.</span>
        <button type="button" className="chip" onClick={onRetry}>Try now</button>
      </div>
    );
  }
  return (
    <div className="sync-bar bad" role="alert">
      <span>This trip was also changed on another device while you were offline. Choose which version to keep. Editing is paused until you do.</span>
      <div className="sync-actions">
        <button type="button" className="chip" disabled={busy} onClick={() => (armed === 'mine' ? void run(onKeepMine) : setArmed('mine'))}>{armed === 'mine' ? 'Tap again: replace theirs' : 'Keep mine'}</button>
        <button type="button" className="chip" disabled={busy} onClick={() => (armed === 'theirs' ? void run(onUseTheirs) : setArmed('theirs'))}>{armed === 'theirs' ? 'Tap again: discard mine' : 'Use theirs'}</button>
        <button type="button" className="chip" onClick={onSaveFile}>Save mine as a file first</button>
      </div>
    </div>
  );
}
