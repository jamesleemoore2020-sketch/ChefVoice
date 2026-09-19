import test from 'node:test';
import assert from 'node:assert/strict';
import { firstTimerIn, timersIn, formatClock } from '../js/step-timers.js';

// Port of StepTimersTest.kt. A wrong timer is worse than no timer, so a duration is only
// recognised when the chef stated a number AND a time unit.

test('reads a plain minute duration', () => {
  const t = firstTimerIn('Simmer for 20 minutes until thickened');
  assert.equal(t.totalSeconds, 1200);
  assert.equal(t.label, '20 minutes');
});
test('reads seconds and hours', () => {
  assert.equal(firstTimerIn('Blanch for 45 seconds').totalSeconds, 45);
  assert.equal(firstTimerIn('Roast for 2 hours').totalSeconds, 7200);
});
test('reads the abbreviations chefs say', () => {
  assert.equal(firstTimerIn('Rest 10 mins').totalSeconds, 600);
  assert.equal(firstTimerIn('Pulse for 90 secs').totalSeconds, 90);
  assert.equal(firstTimerIn('Chill for 1 hr').totalSeconds, 3600);
});
test('reads spoken number words', () => {
  assert.equal(firstTimerIn('Bake for fifteen minutes').totalSeconds, 900);
});
test('a range times the lower bound but keeps the full label', () => {
  const t = firstTimerIn('Saute for 10 to 12 minutes');
  assert.equal(t.totalSeconds, 600);
  assert.equal(t.label, '10 to 12 minutes');
});
test('reads hyphenated ranges', () => {
  assert.equal(firstTimerIn('Fry for 5-7 minutes').totalSeconds, 300);
});
test('reads mixed fractions', () => {
  assert.equal(firstTimerIn('Braise for 1 1/2 hours').totalSeconds, 5400);
  assert.equal(firstTimerIn('Rest for 1/2 hour').totalSeconds, 1800);
  assert.equal(firstTimerIn('Prove for half an hour').totalSeconds, 1800);
});
test('finds every duration in a step, in order', () => {
  const t = timersIn('Sear for 3 minutes, then simmer for 25 minutes');
  assert.equal(t.length, 2);
  assert.equal(t[0].totalSeconds, 180);
  assert.equal(t[1].totalSeconds, 1500);
  assert.ok(t[0].startIndex < t[1].startIndex);
});
test('offers nothing when no duration was stated', () => {
  assert.equal(firstTimerIn('Season generously with salt and pepper'), null);
  assert.equal(firstTimerIn('Cook until the onions are soft'), null);
  assert.equal(firstTimerIn(''), null);
});
test('a bare number with no time unit is not a timer', () => {
  assert.equal(firstTimerIn('Add 2 cups of flour'), null);
  assert.equal(firstTimerIn('Preheat the oven to 350 degrees'), null);
  assert.equal(firstTimerIn('Cut into 4 pieces'), null);
});
test('rejects durations no kitchen would use', () => {
  assert.equal(firstTimerIn('Ferment for 400 hours'), null);
});
test('clock formats the way a timer reads', () => {
  assert.equal(formatClock(1200), '20:00');
  assert.equal(formatClock(45), '0:45');
  assert.equal(formatClock(3900), '1:05:00');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(-30), '0:00');
});
