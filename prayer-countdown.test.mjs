import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextPrayer, formatRemaining } from '../prayer-countdown.js';

const timings = { Fajr: '05:13', Sunrise: '06:36', Dhuhr: '11:56', Asr: '14:44', Maghrib: '17:09', Isha: '18:24' };

test('counts down to Fajr using Erbil time regardless of the device timezone', () => {
  const next = nextPrayer(timings, new Date('2026-11-06T02:12:30Z'));
  assert.deepEqual(next, { name: 'Fajr', tomorrow: false, secondsLeft: 30, time: '05:13' });
  assert.equal(formatRemaining(next.secondsLeft), '00:00:30');
});
test('moves to the next prayer at the exact boundary and skips sunrise', () => {
  const next = nextPrayer(timings, new Date('2026-11-06T05:13:00+03:00'));
  assert.equal(next.name, 'Dhuhr');
  assert.equal(next.secondsLeft, 6 * 3600 + 43 * 60);
  assert.equal(next.tomorrow, false);
});
test('keeps the last partial second positive and switches at the prayer time', () => {
  assert.equal(nextPrayer(timings, new Date('2026-11-06T14:43:59.999+03:00')).secondsLeft, 1);
  assert.equal(nextPrayer(timings, new Date('2026-11-06T14:44:00+03:00')).name, 'Maghrib');
});
test('counts down to estimated Fajr tomorrow after Isha', () => {
  const next = nextPrayer(timings, new Date('2026-11-06T23:59:30+03:00'));
  assert.deepEqual(next, { name: 'Fajr', tomorrow: true, secondsLeft: 5 * 3600 + 13 * 60 + 30, time: '05:13' });
  assert.equal(formatRemaining(next.secondsLeft), '05:13:30');
});
test('uses the new day after midnight and formats long countdowns', () => {
  const next = nextPrayer(timings, new Date('2026-12-01T00:00:00+03:00'));
  assert.equal(next.tomorrow, false);
  assert.equal(formatRemaining(next.secondsLeft), '05:13:00');
  assert.equal(formatRemaining(12 * 3600 + 7 * 60 + 9), '12:07:09');
});
