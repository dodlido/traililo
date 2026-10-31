// Your own words and pictures for a day. Private unless you choose to show friends.
import { useState } from 'react';
import type { Day, JournalEntry, Trip } from './model.ts';
import { driveConnected } from './drive.ts';
import { Pic } from './Pic.tsx';
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

const hhmm = (taken?: string) => (taken ? taken.slice(11, 16) : '');

/** A journal entry placed between two activities: some words, and the day's pictures that belong at that moment. */
export function MomentEditor({ trip, mutate, date, id, at, onClose }: { trip: Trip; mutate: (fn: (t: Trip) => void) => Promise<void>; date: string; id?: string; at?: number; onClose: () => void }) {
  const day = trip.days.find((d) => d.date === date)!;
  const existing = id ? (day.entries.find((e) => e.id === id) as JournalEntry | undefined) : undefined;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [text, setText] = useState(existing?.text ?? '');
  const [ids, setIds] = useState<string[]>(existing?.photoIds ?? []);
  const [err, setErr] = useState('');
  const { busy, error, run } = useSave(mutate, onClose);
  const photos = day.drivePhotos ?? [];
  // pictures already pinned to another journal entry of the day are not offered twice
  const taken = new Set(day.entries.filter((e): e is JournalEntry => e.kind === 'journal' && e.id !== id).flatMap((e) => e.photoIds ?? []));
  const ready = driveConnected();
  const toggle = (pid: string) => setIds((x) => (x.includes(pid) ? x.filter((q) => q !== pid) : [...x, pid]));
  const save = () => {
    if (!text.trim() && ids.length === 0) return setErr('Write something, or pick a picture.');
    setErr('');
    void run((t) => {
      const d = t.days.find((q) => q.date === date)!;
      const entry: JournalEntry = { id: id ?? `${date}-j${Math.random().toString(36).slice(2, 7)}`, kind: 'journal', title: title.trim(), text: text.trim(), photoIds: ids.length ? ids : undefined, notes: [], warnings: [], links: [] };
      const i = id ? d.entries.findIndex((e) => e.id === id) : -1;
      if (i >= 0) d.entries[i] = entry;
      else d.entries.splice(at === undefined ? d.entries.length : Math.max(0, Math.min(at, d.entries.length)), 0, entry);
    });
  };
  const remove = () =>
    void run((t) => {
      const d = t.days.find((q) => q.date === date)!;
      d.entries = d.entries.filter((e) => e.id !== id);
    });
  return (
    <Sheet title={existing ? 'Edit journal entry' : 'New journal entry'} onClose={onClose}>
      <Field label="Title (optional)">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunset at the hotel" autoFocus={!existing} />
      </Field>
      <Field label="What happened" hint="Only you see this. It shows in the recap film at this point of the day.">
        <textarea className="journal-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="The wind, the food, who we met…" />
      </Field>
      {photos.length > 0 ? (
        <Field label="Pictures that belong here" hint="Tap to pin. They show here in the film, whatever time they were taken. Pictures you do not pin are placed by their time.">
          <div className="moment-pics">
            {photos.map((p) => (
              <button key={p.id} type="button" disabled={taken.has(p.id)} className={ids.includes(p.id) ? 'on' : ''} aria-pressed={ids.includes(p.id)} onClick={() => toggle(p.id)}>
                <Pic photo={p} ready={ready} size={240} />
                {!ready && <Icon name="image" size={20} />}
                <span>{hhmm(p.taken)}</span>
              </button>
            ))}
          </div>
          {!ready && <p className="small">Sign in with Google in the pictures section to see them here. You can still pin by time.</p>}
        </Field>
      ) : (
        <p className="small">Add pictures to this day first, and you can pin them to the moment they belong to.</p>
      )}
      {existing && (
        <button type="button" className="show-map edit-entry" onClick={remove} disabled={busy}>
          <Icon name="close" size={16} /> Delete this entry
        </button>
      )}
      <Actions onSave={save} busy={busy} error={err || error} />
    </Sheet>
  );
}
