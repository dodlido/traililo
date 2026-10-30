// Your own words and pictures for a day. Private unless you choose to show friends.
import { useRef, useState } from 'react';
import type { Day, Trip } from './model.ts';
import { Icon } from './Icon.tsx';
import { Actions, Field, Sheet, useSave } from './Edit.tsx';
import { deletePhoto, photoUrlOf, uploadPhoto } from './backend.ts';
import { shrink } from './image.ts';

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

export function JournalEditor({ trip, tripId, mutate, date, onClose }: { trip: Trip; tripId: string; mutate: (fn: (t: Trip) => void) => Promise<void>; date: string; onClose: () => void }) {
  const day = trip.days.find((d) => d.date === date)!;
  const [text, setText] = useState(day.journal?.text ?? '');
  const [photos, setPhotos] = useState<string[]>(day.journal?.photos ?? []);
  const [shared, setShared] = useState(!!day.journal?.shared);
  const [uploading, setUploading] = useState(0);
  const [problem, setProblem] = useState('');
  const added = useRef<string[]>([]); // uploaded in this sheet, removed again if you cancel
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useSave(mutate, onClose);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setProblem('');
    for (const f of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const path = await uploadPhoto(await shrink(f, 1600), tripId);
        added.current.push(path);
        setPhotos((p) => [...p, path]);
      } catch (e) {
        setProblem(e instanceof Error ? e.message : 'Could not upload that picture');
      }
      setUploading((n) => n - 1);
    }
    if (input.current) input.current.value = '';
  };
  const cancel = () => {
    for (const p of added.current) void deletePhoto(p);
    onClose();
  };
  const save = () => {
    const removed = (day.journal?.photos ?? []).filter((p) => !photos.includes(p));
    void run((t) => {
      const d = t.days.find((q) => q.date === date)!;
      if (!text.trim() && photos.length === 0) delete d.journal;
      else d.journal = { text: text.trim(), photos, shared };
    }).then(() => removed.forEach((p) => void deletePhoto(p)));
    added.current = [];
  };
  return (
    <Sheet title={`Journal · ${date}`} onClose={cancel}>
      <Field label="What happened" hint="Only you see this unless you switch on sharing below.">
        <textarea className="journal-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="The wind, the food, who we met…" />
      </Field>
      <Field label="Pictures">
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
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void pick(e.target.files)} />
        <button type="button" className="add-btn" disabled={uploading > 0} onClick={() => input.current?.click()}>
          <Icon name="plus" size={18} /> {uploading > 0 ? `Uploading ${uploading}…` : 'Add pictures'}
        </button>
        {problem && <p role="alert" className="form-error">{problem}</p>}
      </Field>
      <label className="check">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Show this day’s journal to friends
      </label>
      <Actions onSave={save} busy={busy || uploading > 0} error={error} />
    </Sheet>
  );
}
