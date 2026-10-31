// The friends' version of a trip. Run in the browser on every save, so what friends can read is always
// derived from what the owner has, with everything private removed (not merely hidden).
import type { Trip } from './model.ts';

const PERSONAL = /^Assumed:/i;

export function publicVersion(full: Trip): Trip {
  const t = structuredClone(full);
  delete t.packing;
  delete t.recapHidden;
  for (const d of t.days) {
    d.todos = [];
    // journal pages stay private unless you chose to show friends
    if (d.journal && !d.journal.shared) delete d.journal;
    delete d.drivePhotos; // pictures are in the owner's Drive; friends never get the ids
    for (const e of d.entries) {
      delete e.booking;
      delete e.privateNotes;
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
