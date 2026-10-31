// Your own words and pictures for a day. Private unless you choose to show friends.
import { useState } from 'react';
import type { Day, Trip } from './model.ts';
import { Icon } from './Icon.tsx';
import { Actions, Field, Sheet, useSave } from './Edit.tsx';
import { deletePhoto, photoUrlOf } from './backend.ts';

export function JournalBlock({ day, canWrite, onWrite }: { day: Day; canWrite: boolean; onWrite: () => void }) {
  const j = day.journal;
  const has = j && (j.text.trim() || j.photos.length);
  if (!has && !canWrite) return null;
  return (
    <div className="journal">
      <h4>
        Journal{j?.shared ? ' · shown to friends' : ''}
      </h4>
      {has && (
        <>
          {j.text.trim() && <p>{j.text}</p>}
          {j.photos.length > 0 && (
            <div className="journal-photos">
              {j.photos.map((p) => (
                <a key={p} href={photoUrlOf(p)} target="_blank" rel="noopener noreferrer" aria-label="Open picture">
                  <img src={photoUrlOf(p)} alt="" loading="lazy" />
                </a>
              ))}
            </div>
          )}
        </>
      )}
      {canWrite && (
        <button type="button" className="add-btn" onClick={onWrite}>
          <Icon name="edit" size={18} /> {has ? 'Edit journal' : 'Write about this day'}
        </button>
      )}
    </div>
  );
}

export function JournalEditor({ trip, mutate, date, onClose }: { trip: Trip; mutate: (fn: (t: Trip) => void) => Promise<void>; date: string; onClose: () => void }) {
  const day = trip.days.find((d) => d.date === date)!;
  const [text, setText] = useState(day.journal?.text ?? '');
  const [photos, setPhotos] = useState<string[]>(day.journal?.photos ?? []);
  const [shared, setShared] = useState(!!day.journal?.shared);
  const { busy, error, run } = useSave(mutate, onClose);
  const save = () => {
    const removed = (day.journal?.photos ?? []).filter((p) => !photos.includes(p));
    void run((t) => {
      const d = t.days.find((q) => q.date === date)!;
      if (!text.trim() && photos.length === 0) delete d.journal;
      else d.journal = { text: text.trim(), photos, shared };
    }).then(() => removed.forEach((p) => void deletePhoto(p)));
  };
  return (
    <Sheet title={`Journal · ${date}`} onClose={onClose}>
      <Field label="What happened" hint="Only you see this unless you switch on sharing below.">
        <textarea className="journal-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="The wind, the food, who we met…" />
      </Field>
      {photos.length > 0 && (
        <Field label="Earlier pictures" hint="Pictures now come from Google Photos, on the day itself. These were added before that; remove any you no longer want.">
          <div className="journal-photos">
            {photos.map((p) => (
              <div key={p}>
                <img src={photoUrlOf(p)} alt="" />
                <button type="button" className="round small" aria-label="Remove picture" onClick={() => setPhotos((x) => x.filter((q) => q !== p))}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        </Field>
      )}
      <label className="check">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Show this day’s journal to friends
      </label>
      <Actions onSave={save} busy={busy} error={error} />
    </Sheet>
  );
}
