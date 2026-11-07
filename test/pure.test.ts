import { test } from 'node:test';
import assert from 'node:assert/strict';
import { same } from '../src/same.ts';
import { SCHEMA, migrate } from '../src/migrate.ts';
import { applyBooking, matchStay } from '../src/bookingEmail.ts';
import { hikeDistance } from '../src/derive.ts';
import { whereIsToday } from '../src/today.ts';
import { computeTotals } from '../src/totals.ts';
import { simplify, toGpx } from '../src/gpx.ts';
import type { HikeEntry, Trip } from '../src/model.ts';
import { stay, trip } from './helpers.ts';

test('same ignores key order and missing fields', () => {
  assert.ok(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }));
  assert.ok(same({ a: 1, b: undefined }, { a: 1 }));
  assert.ok(!same({ a: 1 }, { a: 2 }));
  assert.ok(!same([1, 2], [1, 2, 3]));
});

test('migrate fills lists and renames old stay types, and is idempotent', () => {
  const old = { id: 't', title: 'x', startDate: '2027-01-01', endDate: '2027-01-02', days: [{ date: '2027-01-01', region: 'r' }], stays: [{ id: 's', name: 'Lodge', type: 'lodge', checkIn: '2027-01-01', checkOut: '2027-01-02', nights: 1 }], totals: {} } as unknown as Trip;
  const m = migrate(old);
  assert.equal(m.schemaVersion, SCHEMA);
  assert.deepEqual(m.days[0].entries, []);
  assert.deepEqual(m.days[0].todos, []);
  assert.equal(m.stays[0].type, 'hotel');
  assert.deepEqual(m.stays[0].privateNotes, []);
  assert.equal(migrate(m), m);
  // a trip with no days at all gets one, so no screen meets an empty list
  assert.equal(migrate({ ...old, days: [], stays: undefined } as unknown as Trip).days[0].date, '2027-01-01');
});

test('a booking for one night inside a longer stay does not shrink it (C1)', () => {
  const s = stay({ id: 's', name: 'Hotel Las Torres', checkIn: '2027-03-10', checkOut: '2027-03-13' });
  const b = { name: 'Hotel Las Torres', checkIn: '2027-03-11', checkOut: '2027-03-12', warnings: [] };
  const m = matchStay([s], b);
  assert.equal(m.kind, 'match');
  const out = applyBooking(m.stay, b, m.kind, 'x');
  assert.equal(out.checkIn, '2027-03-10');
  assert.equal(out.nights, 3);
});

test('one shared word is not a match: Hosteria vs Refugio (C1)', () => {
  const s = stay({ id: 's', name: 'Refugio Patagonia', checkIn: '2027-03-10', checkOut: '2027-03-12' });
  assert.notEqual(matchStay([s], { name: 'Hosteria Patagonia', checkIn: '2027-03-10', checkOut: '2027-03-12', warnings: [] }).kind, 'match');
});

test('hike distance falls back to the first option, flagged as approximate', () => {
  const h = { options: [{ distanceKm: 12 }] } as unknown as HikeEntry;
  assert.deepEqual(hikeDistance(h), { km: 12, approx: true });
  assert.deepEqual(hikeDistance({ distanceKm: 5 } as HikeEntry), { km: 5, approx: false });
  assert.deepEqual(hikeDistance({} as HikeEntry), { approx: false });
});

test('whereIsToday: before, during, gap, after', () => {
  const t = trip(['2027-03-01', '2027-03-02', '2027-03-04']);
  assert.equal(whereIsToday(t, '2027-02-27').state, 'before');
  assert.equal(whereIsToday(t, '2027-02-27').daysTo, 2);
  assert.equal(whereIsToday(t, '2027-03-02').n, 2);
  assert.equal(whereIsToday(t, '2027-03-03').idx, 1); // a gap counts as the last day before it
  assert.equal(whereIsToday(t, '2027-03-09').state, 'after');
});

test('computeTotals works on a trip with no entries', () => {
  const t = computeTotals(trip(['2027-03-01', '2027-03-02']));
  assert.ok(t && typeof t === 'object');
});

test('simplify keeps the ends of a line and drops points on a straight stretch; toGpx writes every line', () => {
  const line = Array.from({ length: 50 }, (_, i) => [10 + i * 0.001, 20]);
  const s = simplify(line, 1);
  assert.deepEqual(s[0], line[0]);
  assert.deepEqual(s[s.length - 1], line[line.length - 1]);
  assert.ok(s.length < 10);
  const g = toGpx('x & y', [line]);
  assert.match(g, /x &amp; y/);
  assert.equal((g.match(/<trkpt /g) ?? []).length, 50);
});

test('kmBetween: known distances, points and [lon, lat] pairs alike', async () => {
  const { kmBetween } = await import('../src/geo.ts');
  // Buenos Aires to Ushuaia is about 2,390 km in a straight line
  const d = kmBetween({ lat: -34.6, lon: -58.4 }, [-68.3, -54.8]);
  assert.ok(d > 2300 && d < 2480, String(d));
  assert.equal(kmBetween([10, 10], { lat: 10, lon: 10 }), 0);
  // across the date line the short way round
  assert.ok(kmBetween([179.9, 0], [-179.9, 0]) < 30);
});
