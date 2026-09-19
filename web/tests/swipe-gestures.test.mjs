import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXIS_LOCK_PX, beginSwipe, DISMISS_THRESHOLD_PX, dismissDirection, dismissOffset,
  isHorizontal, SAVE_THRESHOLD_PX, saveOffset, saveProgress, shouldSave, trackSwipe
} from '../js/swipe-gestures.js';

// Port of the two swipe gestures on Android. The rule that matters most on a phone is the
// axis lock: a finger that starts scrolling the feed must keep scrolling it.

const drag = (dx, dy = 0, steps = [[dx, dy]]) => {
  let state = beginSwipe(0, 0);
  for (const [x, y] of steps) state = trackSwipe(state, x, y);
  return state;
};

test('a gesture has no axis until it has travelled far enough to have one', () => {
  const state = drag(0, 0, [[AXIS_LOCK_PX - 1, 0]]);
  assert.equal(state.axis, '');
  assert.equal(isHorizontal(state), false);
});
test('a mostly sideways gesture locks to the horizontal axis', () => {
  assert.equal(drag(0, 0, [[40, 6]]).axis, 'x');
});
test('a mostly downward gesture locks to the vertical axis', () => {
  assert.equal(drag(0, 0, [[6, 40]]).axis, 'y');
});
test('a scroll that later curves sideways stays a scroll', () => {
  // Otherwise a card could steal a finger halfway down the feed.
  const state = drag(0, 0, [[2, 30], [80, 34]]);
  assert.equal(state.axis, 'y');
  assert.equal(saveOffset(state), 0);
  assert.equal(shouldSave(state, false), false);
});

test('the card follows a rightward drag', () => {
  assert.equal(saveOffset(drag(60, 4)), 60);
});
test('a leftward drag never moves the card', () => {
  assert.equal(saveOffset(drag(-80, 4)), 0);
});
test('travel is clamped just past the threshold, so the dish never slides away', () => {
  assert.equal(saveOffset(drag(900, 4)), SAVE_THRESHOLD_PX * 1.25);
});
test('progress fades the label in and stops at full', () => {
  assert.equal(saveProgress(drag(SAVE_THRESHOLD_PX / 2, 2)), 0.5);
  assert.equal(saveProgress(drag(900, 2)), 1);
});

test('letting go past the threshold saves', () => {
  assert.equal(shouldSave(drag(SAVE_THRESHOLD_PX, 4), false), true);
});
test('letting go short of the threshold does nothing', () => {
  assert.equal(shouldSave(drag(SAVE_THRESHOLD_PX - 1, 4), false), false);
});
test('swiping a recipe that is already saved never unsaves it', () => {
  // The gesture reads as "keep this", not "toggle this".
  assert.equal(shouldSave(drag(900, 4), true), false);
});
test('a vertical scroll never saves', () => {
  assert.equal(shouldSave(drag(0, 0, [[4, 200]]), false), false);
});

test('a notification clears either way', () => {
  assert.equal(dismissDirection(drag(DISMISS_THRESHOLD_PX, 3)), 'right');
  assert.equal(dismissDirection(drag(-DISMISS_THRESHOLD_PX, 3)), 'left');
});
test('a short drag leaves the notification alone', () => {
  assert.equal(dismissDirection(drag(DISMISS_THRESHOLD_PX - 1, 3)), null);
  assert.equal(dismissDirection(drag(-(DISMISS_THRESHOLD_PX - 1), 3)), null);
});
test('a vertical scroll never clears a notification', () => {
  assert.equal(dismissDirection(drag(0, 0, [[3, 150]])), null);
});
test('a notification row follows the finger in both directions, within a limit', () => {
  assert.equal(dismissOffset(drag(40, 3)), 40);
  assert.equal(dismissOffset(drag(-40, 3)), -40);
  assert.equal(dismissOffset(drag(900, 3)), DISMISS_THRESHOLD_PX * 1.5);
  assert.equal(dismissOffset(drag(-900, 3)), -DISMISS_THRESHOLD_PX * 1.5);
  assert.equal(dismissOffset(drag(0, 0, [[3, 150]])), 0);
});
