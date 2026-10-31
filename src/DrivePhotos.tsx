// A day's pictures. They are chosen in Google Photos and kept in a folder this app makes in the owner's own Google Drive;
// only the Drive file ids are in the trip. The pictures load from Google once the owner has tapped to connect.
import { useEffect, useState } from 'react';
import type { Day, Trip } from './model.ts';
import { Icon } from './Icon.tsx';
import { chooseInPhotos, connectDrive, driveAvailable, driveConnected, driveLink, driveName, localTaken, pictureBlob, pictureSrc, placeOnDays, saveToDrive, tripFolder } from './drive.ts';
import type { DrivePhoto } from './model.ts';

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

export function DrivePhotosBlock({ day, trip, canWrite, mutate }: { day: Day; trip: Trip; canWrite: boolean; mutate: (fn: (t: Trip) => void) => Promise<void> }) {
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('traililo:pics-closed') !== '1';
    } catch {
      return true;
    }
  });
  const photos = day.drivePhotos ?? [];
  if (!driveAvailable() || (photos.length === 0 && !canWrite)) return null;
  const ready = driveConnected();
  const fail = (e: unknown) => setNote(e instanceof Error ? e.message : 'Something went wrong with Google.');
  const connect = async () => {
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
    // opened in the same tap, because browsers only allow a popup then; Google Photos is loaded into it a moment later
    const popup = window.open('about:blank', '_blank');
    setBusy(true);
    setLink('');
    setNote('Choose your pictures in Google Photos, then come back here.');
    try {
      const picks = await chooseInPhotos(popup, setLink);
      setLink('');
      if (picks.length === 0) {
        setNote('No pictures were chosen.');
        setBusy(false);
        return;
      }
      const folder = await tripFolder(trip.title);
      const lon = day.point?.lon;
      const have = new Set(trip.days.flatMap((d) => d.drivePhotos?.map((p) => p.name) ?? []));
      const saved: DrivePhoto[] = [];
      let failed = 0;
      let already = 0;
      let reason = '';
      for (const [i, pic] of picks.entries()) {
        const taken = localTaken(pic.created, lon);
        if (have.has(driveName(pic, taken))) {
          already++;
          continue;
        }
        setNote(`Saving to your Drive: ${i + 1} of ${picks.length}…`);
        try {
          saved.push(await saveToDrive(pic, folder, taken));
        } catch (e) {
          failed++;
          reason ||= e instanceof Error ? e.message : '';
        }
      }
      let result = { placed: 0, skipped: 0, elsewhere: 0 };
      if (saved.length) {
        await mutate((t) => {
          result = placeOnDays(t.days, saved, day.date);
        });
        tick((n) => n + 1);
      }
      const parts = [saved.length ? `Saved ${saved.length} ${saved.length === 1 ? 'picture' : 'pictures'} to the “TraiLilo · ${trip.title}” folder in your Drive` : 'Nothing new was saved'];
      if (result.elsewhere) parts.push(`${result.elsewhere} went to the day ${result.elsewhere === 1 ? 'it was' : 'they were'} taken`);
      if (already) parts.push(`${already} already there`);
      if (failed) parts.push(`${failed} could not be saved${reason ? ` (${reason})` : ''}`);
      setNote(`${parts.join(', ')}.`);
    } catch (e) {
      try {
        popup?.close();
      } catch {
        /* already closed */
      }
      setLink('');
      fail(e);
    }
    setBusy(false);
  };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem('traililo:pics-closed', next ? '0' : '1');
    } catch {
      /* fine without it */
    }
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
      <h4>
        <button type="button" className="fold-head" aria-expanded={open} onClick={toggle}>
          <Icon name="next" size={16} /> Pictures{photos.length > 0 ? ` · ${photos.length}` : ''}
        </button>
      </h4>
      {open && photos.length > 0 && (
        <div className="journal-photos">
          {photos.map((p) => (
            <Tile key={p.id} id={p.id} name={p.name} ready={ready} onRemove={canWrite ? () => remove(p.id) : undefined} />
          ))}
        </div>
      )}
      {open && (
        <>
      {!ready && (photos.length > 0 || canWrite) && (
        <button type="button" className="add-btn" disabled={busy} onClick={() => void connect()}>
          <Icon name="image" size={18} /> {busy ? 'Connecting…' : photos.length > 0 ? 'Show pictures (sign in with Google)' : 'Connect Google to add pictures'}
        </button>
      )}
      {ready && canWrite && (
        <button type="button" className="add-btn" disabled={busy} onClick={() => void add()}>
          <Icon name="plus" size={18} /> {busy ? 'Working…' : 'Add pictures from Google Photos'}
        </button>
      )}
      {link && (
        <a className="add-btn" href={link} target="_blank" rel="noopener noreferrer">
          Open Google Photos to choose
        </a>
      )}
      {photos.length === 0 && canWrite && !note && <p className="hint">You choose in Google Photos. Copies are kept in a folder in your own Google Drive; this app only remembers which ones belong to which day.</p>}
      {note && <p role="status" className="hint">{note}</p>}
        </>
      )}
    </div>
  );
}
