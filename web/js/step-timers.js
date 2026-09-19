// Port of app/.../util/StepTimers.kt. Keep the two in step.
//
// Finds the durations already present in a finished method step so the cook-along screen
// can offer them as timers. A read-only extractor: it never edits a step and is not part of
// the cooking parser, so it cannot change a golden-corpus row. A duration is only
// recognised when the chef stated a number and a time unit; anything else yields no timer
// rather than a guess, because a wrong timer calls the chef back at the wrong moment.

const numberWords = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, ninety: 90, half: 0.5, quarter: 0.25
};

const NUMBER = '\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?|one|two|three|four|five|six|seven|' +
  'eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|' +
  'twenty|thirty|forty|fifty|sixty|ninety|half|quarter';

const durationSource = '\\b(' + NUMBER + ')' +
  '(?:\\s+(\\d+\\s*/\\s*\\d+))?' +
  '(?:\\s*(?:-|–|to|or)\\s*(' + NUMBER + '))?' +
  '\\s*(?:an?\\s+)?' +
  '(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\b';

/** A range times the lower bound, so the chef is called back while there is still a decision. */
export const rangeUsesLowerBound = true;

function amountOf(token) {
  const clean = String(token || '').trim().toLowerCase();
  if (!clean) return null;
  if (Object.prototype.hasOwnProperty.call(numberWords, clean)) return numberWords[clean];
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length !== 2) return null;
    const numerator = Number(parts[0].trim());
    const denominator = Number(parts[1].trim());
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
    return numerator / denominator;
  }
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

function secondsFor(amount, unit) {
  const lower = unit.toLowerCase();
  let multiplier;
  if (lower.startsWith('sec')) multiplier = 1;
  else if (lower.startsWith('min')) multiplier = 60;
  else if (lower.startsWith('hour') || lower.startsWith('hr')) multiplier = 3600;
  else return null;
  const seconds = amount * multiplier;
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

/** Every duration in `step`, in the order the chef said them: {label, totalSeconds, startIndex}. */
export function timersIn(step) {
  if (!step || !String(step).trim()) return [];
  const out = [];
  for (const match of String(step).matchAll(new RegExp(durationSource, 'gi'))) {
    const base = amountOf(match[1]);
    if (base === null) continue;
    // "1 1/2 hours" -- a whole number followed by a bare fraction.
    const amount = match[2] ? base + (amountOf(match[2]) ?? 0) : base;
    const effective = match[3] && !rangeUsesLowerBound ? (amountOf(match[3]) ?? amount) : amount;
    const seconds = secondsFor(effective, match[4]);
    if (seconds === null || seconds <= 0) continue;
    // Nothing in a kitchen is usefully timed beyond a day; a match that long is a misread.
    if (seconds > 24 * 60 * 60) continue;
    out.push({ label: match[0].trim(), totalSeconds: seconds, startIndex: match.index });
  }
  return out;
}

export function firstTimerIn(step) {
  return timersIn(step)[0] ?? null;
}

/** "1:05:00", "20:00", "0:45" -- how a running timer reads on screen. */
export function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const two = n => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
