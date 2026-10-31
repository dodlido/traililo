// A starting packing list made from what the trip contains. The owner edits it from there.
import type { PackItem, Trip } from './model.ts';

const G = { docs: 'Papers and money', wear: 'Clothes', hike: 'Hiking', tech: 'Tech', health: 'Health and care', extra: 'Extras' };

export function makePacking(trip: Trip): PackItem[] {
  const entries = trip.days.flatMap((d) => d.entries);
  const has = (re: RegExp) => entries.some((e) => re.test(e.title + ' ' + e.notes.join(' ')));
  const countries = new Set(trip.days.map((d) => d.country).filter(Boolean));
  const hikes = entries.filter((e) => e.kind === 'hike').length;
  const ferries = entries.some((e) => e.kind === 'commute' && e.legs.some((l) => l.mode === 'ferry'));
  const flights = entries.some((e) => e.kind === 'commute' && e.legs.some((l) => l.mode === 'flight'));
  const treks = entries.some((e) => e.kind === 'hike' && (e.durationMin ?? 0) >= 360) || trip.stays.some((s) => s.type === 'camp');
  const list: [string, string][] = [
    [G.docs, 'Passports (valid for 6+ months)'],
    [G.docs, 'Printed or offline copies of bookings'],
    [G.docs, 'Travel insurance details'],
    [G.docs, 'Cards, plus some cash in dollars and local pesos'],
    [G.wear, 'Base layers (top and bottom)'],
    [G.wear, 'Warm mid-layer fleece'],
    [G.wear, 'Waterproof, windproof shell'],
    [G.wear, 'Quick-dry hiking trousers'],
    [G.wear, 'Warm hat and gloves'],
    [G.wear, 'Sun hat and sunglasses'],
    [G.wear, 'Hiking socks, 3 or 4 pairs'],
    [G.wear, 'Comfortable shoes for towns'],
    [G.tech, 'Phone and charger'],
    [G.tech, 'Power bank'],
    [G.tech, 'Plug adapter (Type C works in both Argentina and Chile)'],
    [G.tech, 'Headlamp'],
    [G.health, 'Sunscreen and lip balm'],
    [G.health, 'First-aid kit and blister plasters'],
    [G.health, 'Personal medicines'],
    [G.health, 'Insect repellent'],
    [G.extra, 'Reusable water bottle'],
    [G.extra, 'Daypack rain cover'],
    [G.extra, 'Snacks for long hiking days'],
  ];
  if (hikes) list.push([G.hike, 'Broken-in hiking boots'], [G.hike, 'Daypack, 20 to 30 litres'], [G.hike, 'Trekking poles'], [G.hike, 'A maps app with offline maps (Organic Maps or OsmAnd) and the trail files from the "Open in maps app" button']);
  if (hikes >= 8) list.push([G.hike, 'Gaiters for muddy or snowy sections']);
  if (treks) list.push([G.hike, 'Sleeping bag liner'], [G.hike, 'Earplugs for shared dorms'], [G.hike, 'Cash for refugios (cards are often not accepted)']);
  if (countries.size > 1) list.push([G.docs, 'Border papers and a printed car-rental permit for crossings'], [G.docs, 'Small cash in both countries’ currencies']);
  if (has(/glacier|ice trek|perito/i)) list.push([G.wear, 'Warm layer for the glacier boats and viewpoints'], [G.hike, 'Crampons are lent on glacier treks, so skip them']);
  if (has(/thermal|hot spring|termas/i)) list.push([G.extra, 'Swimsuit and quick-dry towel']);
  if (has(/kayak|raft|swim|lake/i)) list.push([G.extra, 'Swimsuit and water shoes'], [G.extra, 'Dry bag for the phone']);
  if (has(/bike|cycl/i)) list.push([G.extra, 'Padded shorts or a seat cover for bike days'], [G.extra, 'Cycling gloves']);
  if (ferries) list.push([G.health, 'Motion-sickness tablets for the ferries']);
  if (flights) list.push([G.extra, 'Soft bag for the small domestic planes, with a strict weight limit']);
  if (has(/drive|car rental|rent/i)) list.push([G.docs, 'Driver’s licence and an international permit'], [G.extra, 'Phone holder for the car']);
  return list.map(([group, text], i) => ({ id: `p${i}${Math.random().toString(36).slice(2, 5)}`, group, text, done: false }));
}
