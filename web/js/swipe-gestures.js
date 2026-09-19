// Port of the swipe gestures in app/.../ui/ChefVoiceApp.kt. Keep the two in step.
//
// Two gestures, with opposite tempers:
//
//  * **Save a Community recipe**: rightward travel only, and it only ever *adds*. Dragging a
//    dish that is already saved must not quietly unsave it, because the gesture reads as
//    "keep this", not "toggle this" -- the same rule the double-tap like follows.
//  * **Clear a notification**: either direction, because there is nothing to get wrong; the
//    row is one alert and clearing it is what both directions mean.
//
// The decisions live here as pure functions so they can be tested without a browser. The one
// that matters most on a phone is the axis lock: a finger that starts moving down the feed
// must keep scrolling the feed, and must never have its scroll stolen by a card that thought
// it was being swiped.

/** 110.dp on Android. Far enough to be deliberate, short enough to reach with a thumb. */
export const SAVE_THRESHOLD_PX = 110;
export const DISMISS_THRESHOLD_PX = 96;
/** How far a finger must travel before the gesture commits to an axis. */
export const AXIS_LOCK_PX = 10;

export function beginSwipe(x, y) {
  return { startX: x, startY: y, dx: 0, dy: 0, axis: '' };
}

/**
 * Moves the gesture to a new pointer position. `axis` locks to 'x' or 'y' as soon as the
 * finger has travelled far enough to tell a swipe from a scroll, and never changes after:
 * a gesture that began as a scroll stays a scroll for its whole life.
 */
export function trackSwipe(state, x, y, axisLockPx = AXIS_LOCK_PX) {
  const dx = x - state.startX;
  const dy = y - state.startY;
  let axis = state.axis;
  if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) >= axisLockPx) {
    axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  }
  return { ...state, dx, dy, axis };
}

export const isHorizontal = state => state.axis === 'x';

/**
 * How far the card should follow the finger. Zero for a leftward drag, and clamped just past
 * the threshold so the travel stays a hint rather than sliding the dish off the screen.
 */
export function saveOffset(state, threshold = SAVE_THRESHOLD_PX) {
  if (!isHorizontal(state)) return 0;
  return Math.min(Math.max(state.dx, 0), threshold * 1.25);
}

/** 0 to 1: how far through the save gesture the chef is, for fading the label in. */
export const saveProgress = (state, threshold = SAVE_THRESHOLD_PX) =>
  Math.min(saveOffset(state, threshold) / threshold, 1);

/** Whether letting go here should save. Never true for something already saved. */
export function shouldSave(state, alreadySaved, threshold = SAVE_THRESHOLD_PX) {
  if (alreadySaved) return false;
  return isHorizontal(state) && state.dx >= threshold;
}

/** 'left', 'right' or null -- which way a notification row was cleared, if it was. */
export function dismissDirection(state, threshold = DISMISS_THRESHOLD_PX) {
  if (!isHorizontal(state)) return null;
  if (state.dx >= threshold) return 'right';
  if (state.dx <= -threshold) return 'left';
  return null;
}

/** How far a notification row should follow the finger, either way. */
export function dismissOffset(state, threshold = DISMISS_THRESHOLD_PX) {
  if (!isHorizontal(state)) return 0;
  const limit = threshold * 1.5;
  return Math.min(Math.max(state.dx, -limit), limit);
}
