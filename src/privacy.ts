// The friends' version of a trip. Run in the browser on every save, so what friends can read is always
// derived from what the owner has, with everything private removed (not merely hidden).
import type { Trip } from './model.ts';

const PERSONAL = /^Assumed:/i;

export function publicVersion(full: Trip): Trip {
  const t = structuredClone(full);
  delete t.packing;
  delete t.recapHidden;
  // home is wherever the owner's account says; friends get neither its position nor any road that starts or ends there
  const homes = new Set(t.stays.filter((s) => s.type === 'home').map((s) => s.id));
  for (const s of t.stays) if (homes.has(s.id)) {
    delete s.point;
    delete s.location;
    delete s.booking;
  }
  for (const d of t.days) {
    d.todos = [];
    // journal pages stay private unless you chose to show friends
    if (d.journal && !d.journal.shared) delete d.journal;
    delete d.drivePhotos; // pictures are in the owner's Drive; friends never get the ids
    if (d.stayId && homes.has(d.stayId)) delete d.point;
    for (const e of d.entries) {
      delete e.booking;
      delete e.privateNotes;
      if (e.kind === 'commute')
        for (const l of e.legs) {
          if (l.fromHome) delete l.fromPoint;
          if (l.toHome) delete l.toPoint;
          if (l.fromHome || l.toHome) delete l.path;
        }
      e.notes = (e.notes ?? []).filter((n) => !PERSONAL.test(n));
      e.links = (e.links ?? []).filter((l) => l.url);
    }
  }
  for (const s of t.stays) {
    delete s.booking;
    s.privateNotes = [];
    s.notes = (s.notes ?? []).filter((n) => !PERSONAL.test(n));
  }
  t.totals.openTodos = 0;
  return t;
}
