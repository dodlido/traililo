// A day's pictures from the owner's Google Drive. Only the file ids are in the trip; the pictures load from Google
// once the owner has tapped to connect, and never go through this app's own storage.
import { useEffect, useState } from 'react';
import type { Day, Trip } from './model.ts';
import { Icon } from './Icon.tsx';
import { connectDrive, describe, driveAvailable, driveConnected, driveLink, pickPictures, pictureBlob, pictureSrc, placeOnDays } from './drive.ts';

function Tile({ id, name, ready, onRemove }: { id: string; name: string; ready: boolean; onRemove?: () => void }) {
  const [src, setSrc] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    pictureSrc(id).then(
      (s) => live && setSrc(s),
      () => live && setSrc(''),
    );
    return () => {
      live = false;
    };
  }, [id, ready]);
  const fallback = () => {
    if (tried) return;
    setTried(true);
    pictureBlob(id).then(setSrc, () => setSrc(''));
  };
  return (
    <div>
      <a href={driveLink(id)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} in Google Drive`}>
        {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={fallback} /> : <span className="drive-empty" aria-hidden="true"><Icon name="image" size={22} /></span>}
      </a>
      {onRemove && (
        <button type="button" className="round small" aria-label="Remove picture from this day" onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export function DrivePhotosBlock({ day, canWrite, mutate }: { day: Day; canWrite: boolean; mutate: (fn: (t: Trip) => void) => Promise<void> }) {
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const photos = day.drivePhotos ?? [];
  if (!driveAvailable() || (photos.length === 0 && !canWrite)) return null;
  const ready = driveConnected();
  const fail = (e: unknown) => setNote(e instanceof Error ? e.message : 'Something went wrong with Google Drive.');
  const show = async () => {
    setBusy(true);
    setNote('');
    try {
      await connectDrive();
      tick((n) => n + 1);
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };
  const add = async () => {
    setBusy(true);
    setNote('');
    try {
      const docs = await pickPictures();
      if (docs.length) {
        const found = await describe(docs);
        let result = { placed: 0, skipped: 0, elsewhere: 0 };
        await mutate((t) => {
          result = placeOnDays(t.days, found, day.date);
        });
        tick((n) => n + 1);
        if (result.placed === 0) setNote('Those pictures were already added.');
        else {
          const parts = [`Added ${result.placed} ${result.placed === 1 ? 'picture' : 'pictures'}`];
          if (result.elsewhere) parts.push(`${result.elsewhere} went to the day ${result.elsewhere === 1 ? 'it was' : 'they were'} taken`);
          if (result.skipped) parts.push(`${result.skipped} already there`);
          setNote(`${parts.join(', ')}.`);
        }
      }
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };
  const remove = (id: string) =>
    void mutate((t) => {
      const d = t.days.find((q) => q.date === day.date);
      if (!d?.drivePhotos) return;
      d.drivePhotos = d.drivePhotos.filter((p) => p.id !== id);
      if (d.drivePhotos.length === 0) delete d.drivePhotos;
    });
  return (
    <div className="journal drive-photos">
      <h4>Pictures</h4>
      {photos.length > 0 && (
        <div className="journal-photos">
          {photos.map((p) => (
            <Tile key={p.id} id={p.id} name={p.name} ready={ready} onRemove={canWrite ? () => remove(p.id) : undefined} />
          ))}
        </div>
      )}
      {photos.length > 0 && !ready && (
        <button type="button" className="add-btn" disabled={busy} onClick={() => void show()}>
          <Icon name="image" size={18} /> {busy ? 'Connecting…' : 'Show pictures (sign in with Google)'}
        </button>
      )}
      {canWrite && (
        <button type="button" className="add-btn" disabled={busy} onClick={() => void add()}>
          <Icon name="plus" size={18} /> {busy ? 'Working…' : 'Add pictures from Google Drive'}
        </button>
      )}
      {photos.length === 0 && canWrite && <p className="hint">The pictures stay in your Drive. This app only remembers which ones you picked, and only for this trip.</p>}
      {note && <p role="status" className="hint">{note}</p>}
    </div>
  );
}
