import type { Day, Stay, Trip } from '../src/model.ts';

export const stay = (o: Partial<Stay> & { id: string; name: string; checkIn: string; checkOut: string }): Stay => ({
  type: 'hotel',
  nights: Math.round((Date.parse(o.checkOut) - Date.parse(o.checkIn)) / 86400000),
  notes: [],
  privateNotes: [],
  ...o,
});
export const day = (date: string, o: Partial<Day> = {}): Day => ({ date, region: 'Test', entries: [], todos: [], ...o });
export const trip = (dates: string[], stays: Stay[] = []): Trip =>
  ({ id: 't', title: 'T', startDate: dates[0], endDate: dates[dates.length - 1], days: dates.map((d) => day(d)), stays, totals: {} }) as unknown as Trip;
