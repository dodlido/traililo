// Lines drawn on the map for a day (a walk, a drive, a boat ride, a scenic route): shown in the journey and editable.
import { useState } from 'react';
import type { RouteLine, Trip } from './model.ts';
import { Icon } from './Icon.tsx';
import { Actions, Field, PlaceSearch, Sheet, useSave } from './Edit.tsx';
import { routeJob } from './autoroute.ts';

export const LINE_MODES: { id: RouteLine['mode']; label: string; icon: string }[] = [
  { id: 'drive', label: 'Drive or bus', icon: 'bus' },
  { id: 'ferry', label: 'Ferry or boat', icon: 'ferry' },
  { id: 'trek', label: 'Walk or trek', icon: 'hike' },
  { id: 'scenic', label: 'Scenic route', icon: 'map' },
];
const km = (pts: { lat: number; lon: number }[]) => {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot((pts[i].lon - pts[i - 1].lon) * 111.32 * Math.cos(((pts[i].lat + pts[i - 1].lat) / 2) * Math.PI / 180), (pts[i].lat - pts[i - 1].lat) * 110.57);
  return Math.round(n * 10) / 10;
};

/** One line, shown among the day's entries. */
export function LineRow({ line, canEdit, onEdit, hidden }: { line: RouteLine; canEdit: boolean; onEdit: () => void; hidden?: boolean }) {
  const m = LINE_MODES.find((x) => x.id === line.mode)!;
  return (
    <article className={`entry kind-line mode-${line.mode}`}>
      <span className="entry-icon">
        <Icon name={m.icon} size={20} />
      </span>
      <div className="entry-main">
        <h3>{line.name}</h3>
        <p className="facts-line">
          {m.label} · {km(line.points)} km on the map{line.stops ? ` · ${line.stops.length} points` : ''}
        </p>
        {hidden && <p className="facts-line">Not drawn on the map, because this day’s hike has its own trail.</p>}
        {canEdit && (
          <button type="button" className="show-map edit-entry" onClick={onEdit}>
            <Icon name="edit" size={16} /> Edit
          </button>
        )}
      </div>
    </article>
  );
}

export function LineEditor({ trip, mutate, date, id, start, onClose }: { trip: Trip; mutate: (fn: (t: Trip) => void) => Promise<void>; date: string; id?: string; start?: { name: string; point: { lat: number; lon: number; approx?: boolean } }; onClose: () => void }) {
  const existing = id ? trip.lines?.find((l) => l.id === id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [mode, setMode] = useState<RouteLine['mode']>(existing?.mode ?? 'trek');
  const [replace, setReplace] = useState(existing?.replace ?? false);
  const [stops, setStops] = useState<{ name: string; point: { lat: number; lon: number; approx?: boolean } }[]>(existing?.stops ?? existing?.points.map((point, i) => ({ name: `Point ${i + 1}`, point })) ?? (start ? [{ name: start.name.split(',')[0].trim(), point: start.point }] : []));
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const { busy, error, run } = useSave(mutate, onClose);
  const first = JSON.stringify(existing?.stops ?? existing?.points.map((point, i) => ({ name: `Point ${i + 1}`, point })) ?? (start ? [{ name: start.name.split(',')[0].trim(), point: start.point }] : []));
  const move = (i: number, dir: -1 | 1) => setStops((s) => { const n = [...s]; const j = i + dir; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const save = async () => {
    setErr(null);
    if (!name.trim()) return setErr('Give the line a name.');
    if (stops.length < 2) return setErr('Add at least a start and an end.');
    const pts = stops.map((s) => s.point);
    let points = pts;
    let routed = !!existing?.routed;
    const changed = JSON.stringify(stops) !== first || mode !== existing?.mode;
    if (existing && !changed) points = existing.points;
    else if (mode === 'drive' || mode === 'ferry') {
      setWorking(true);
      try {
        const r = await routeJob({ date, entry: '', leg: -1, mode, from: pts[0], to: pts[pts.length - 1], via: pts.slice(1, -1), label: name });
        if (r) points = r.path.map(([lon, lat]) => ({ lon, lat }));
      } catch {
        /* stays a straight line between the points */
      }
      setWorking(false);
      routed = true;
    } else routed = false;
    const line: RouteLine = { id: existing?.id ?? `${date}-L${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), date, mode, points, replace, stops, routed };
    void run((t) => {
      t.lines ??= [];
      const i = t.lines.findIndex((l) => l.id === line.id);
      if (i >= 0) t.lines[i] = line;
      else t.lines.push(line);
    });
  };
  const remove = () => run((t) => { t.lines = (t.lines ?? []).filter((l) => l.id !== id); });
  return (
    <Sheet title={existing ? 'Edit route on map' : 'New route on map'} onClose={onClose}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!existing} placeholder="Walk to the refugio" /></Field>
      <Field label="Type" hint="Drives, buses and ferries follow the road or water line between your points.">
        <select value={mode} onChange={(e) => setMode(e.target.value as RouteLine['mode'])}>
          {LINE_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      <Field label="Points, in order" hint="Search a place or tap the map to add each point. Use the arrows to reorder.">
        <ul className="wp-list">
          {stops.map((w, i) => (
            <li key={i}>
              <b>{i + 1}</b>
              <input value={w.name} aria-label={`Point ${i + 1} name`} onChange={(e) => setStops(stops.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)))} />
              <button type="button" className="round small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="back" size={14} /></button>
              <button type="button" className="round small" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => move(i, 1)}><Icon name="next" size={14} /></button>
              <button type="button" className="round small" aria-label="Remove point" onClick={() => setStops(stops.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ul>
        <PlaceSearch keepOpen near={stops[stops.length - 1]?.point} onClear={() => {}} onPick={(n, p) => setStops((s) => [...s, { name: n.split(',')[0].trim(), point: p }])} />
      </Field>
      <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Draw this instead of the plain line between the two nights</label>
      {working && <p className="road">Finding the way…</p>}
      <Actions onSave={save} busy={busy || working} error={err ?? error} onDelete={existing ? remove : undefined} />
    </Sheet>
  );
}
