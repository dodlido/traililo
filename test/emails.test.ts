import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBookingEmail } from '../src/bookingEmail.ts';
import { parseGetYourGuide } from '../src/activityEmail.ts';

test('Booking.com: a time line above the address is not taken as the place name', () => {
  const r = parseBookingEmail(['Your booking in El Calafate is confirmed.', 'Check-in Fri, 12 Mar 2027 from 14:00', 'Check-out Sun, 14 Mar 2027 until 11:00', 'From 14:00 until 23:00', 'Calle Falsa 123, El Calafate, Argentina - Get directions'].join('\n'));
  assert.notEqual(r.name, 'From 14:00 until 23:00');
  assert.equal(r.checkIn, '2027-03-12');
  assert.equal(r.checkOut, '2027-03-14');
});

test('Airbnb: dates with no year are placed in the next year they fall in, with a warning', () => {
  const email = ['Airbnb', "You're all set for Bariloche!", 'Cabin by the lake', 'Entire cabin hosted by Ana', 'Check-in Checkout', 'Fri, Mar 12 3:00 PM Sun, Mar 14 11:00 AM', 'Address', 'Ruta 40, Bariloche', 'Confirmation code HMABCD1234'].join('\n');
  const r = parseBookingEmail(email, new Date('2026-11-07T00:00:00Z'));
  assert.equal(r.checkIn, '2027-03-12');
  assert.equal(r.checkOut, '2027-03-14');
  assert.ok(r.warnings.some((w) => /no year/i.test(w)));
  assert.equal(r.checkInTime, '15:00');
});

test('GetYourGuide: a day-first date is read', () => {
  const r = parseGetYourGuide('Booking reference: GYG123ABC456 16 March 2027 at 10:30 AM Glacier Perito Moreno Big Ice 2 Adults (Age 18 - 50) • English • 7.5 hours');
  assert.equal(r.date, '2027-03-16');
  assert.equal(r.startTime, '10:30');
  assert.match(r.title, /Perito Moreno/);
});

test('GetYourGuide: the month-first date still works', () => {
  const r = parseGetYourGuide('Booking reference: GYG123ABC456 March 16, 2027 at 10:30 AM Glacier Perito Moreno Big Ice 2 Adults (Age 18 - 50) • English • 7.5 hours');
  assert.equal(r.date, '2027-03-16');
});
