import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCookCommand, clearTimer, currentStep, initialCookState, goToStep, nextStep,
  previousStep, repeatStep, setHandsFree, setReadAloud, startTimer, tickTimer,
  timersForStep, toggleTimerPause
} from '../js/cook-along.js';
import { CookCommand } from '../js/cook-commands.js';

// Port of CookingScreen's state handling. The rules that matter in a kitchen: a command
// never runs off the end of the recipe, a timer is only ever offered for a duration the chef
// actually said, and asking for a step again says it again.

const steps = ['Heat the pan for 2 minutes', 'Add the onions', 'Simmer for 20 to 25 minutes'];
const fresh = () => initialCookState(steps);

test('a new session starts on the first step, silent and not listening', () => {
  const s = fresh();
  assert.equal(s.stepIndex, 0);
  assert.equal(s.readAloud, false);
  assert.equal(s.handsFree, false);
  assert.equal(s.timer, null);
  assert.equal(currentStep(s), steps[0]);
});

test('next stops at the last step instead of running off the end', () => {
  let s = nextStep(nextStep(fresh()));
  assert.equal(s.stepIndex, 2);
  s = nextStep(s);
  assert.equal(s.stepIndex, 2);
});
test('previous stops at the first step', () => {
  const s = previousStep(fresh());
  assert.equal(s.stepIndex, 0);
});
test('a recipe with no steps has nowhere to go', () => {
  const s = nextStep(initialCookState([]));
  assert.equal(s.stepIndex, 0);
  assert.equal(currentStep(s), '');
});
test('moving a step asks for it to be spoken', () => {
  const s = fresh();
  assert.equal(nextStep(s).speakToken, s.speakToken + 1);
});
test('a move that goes nowhere does not re-speak', () => {
  const s = fresh();
  assert.equal(previousStep(s).speakToken, s.speakToken);
});
test('goToStep clamps rather than throwing', () => {
  assert.equal(goToStep(fresh(), 99).stepIndex, 2);
  assert.equal(goToStep(fresh(), -4).stepIndex, 0);
});

test('turning reading on says the step the chef is already looking at', () => {
  const s = fresh();
  const on = setReadAloud(s, true);
  assert.equal(on.readAloud, true);
  assert.equal(on.speakToken, s.speakToken + 1);
});
test('turning reading off does not queue more speech', () => {
  const on = setReadAloud(fresh(), true);
  const off = setReadAloud(on, false);
  assert.equal(off.readAloud, false);
  assert.equal(off.speakToken, on.speakToken);
});
test('repeat says the same step again without moving', () => {
  const s = fresh();
  const again = repeatStep(s);
  assert.equal(again.stepIndex, s.stepIndex);
  assert.equal(again.speakToken, s.speakToken + 1);
});

test('timers come only from durations stated in this step', () => {
  const s = fresh();
  assert.deepEqual(timersForStep(s).map(t => t.totalSeconds), [120]);
  assert.deepEqual(timersForStep(nextStep(s)), []);
});
test('a range calls the chef back at its lower bound', () => {
  const s = goToStep(fresh(), 2);
  assert.equal(timersForStep(s)[0].totalSeconds, 20 * 60);
});

test('a timer counts down and then reports itself finished', () => {
  let s = startTimer(fresh(), { label: '2 minutes', totalSeconds: 2 });
  assert.equal(s.timer.remainingSeconds, 2);
  s = tickTimer(s);
  assert.equal(s.timer.finished, false);
  s = tickTimer(s);
  assert.equal(s.timer.remainingSeconds, 0);
  assert.equal(s.timer.finished, true);
});
test('a finished timer stays finished rather than going negative', () => {
  let s = startTimer(fresh(), { label: '1 minute', totalSeconds: 1 });
  s = tickTimer(tickTimer(tickTimer(s)));
  assert.equal(s.timer.remainingSeconds, 0);
});
test('a paused timer does not move', () => {
  let s = toggleTimerPause(startTimer(fresh(), { label: '2 minutes', totalSeconds: 120 }));
  assert.equal(s.timer.paused, true);
  s = tickTimer(s);
  assert.equal(s.timer.remainingSeconds, 120);
  s = tickTimer(toggleTimerPause(s));
  assert.equal(s.timer.remainingSeconds, 119);
});
test('ticking with no timer is harmless', () => {
  const s = fresh();
  assert.equal(tickTimer(s), s);
});
test('a timer with no duration is not started', () => {
  const s = fresh();
  assert.equal(startTimer(s, { label: 'soon', totalSeconds: 0 }), s);
  assert.equal(startTimer(s, null), s);
});
test('clearing a timer removes it', () => {
  assert.equal(clearTimer(startTimer(fresh(), { label: '2 minutes', totalSeconds: 120 })).timer, null);
});
test('a running timer survives moving to the next step', () => {
  const s = nextStep(startTimer(fresh(), { label: '2 minutes', totalSeconds: 120 }));
  assert.equal(s.timer.remainingSeconds, 120);
});

test('"next" and "back" move the same way the buttons do', () => {
  let s = applyCookCommand(fresh(), CookCommand.NEXT);
  assert.equal(s.stepIndex, 1);
  s = applyCookCommand(s, CookCommand.PREVIOUS);
  assert.equal(s.stepIndex, 0);
});
test('"read out loud" turns reading on, and asks again when it is already on', () => {
  const s = applyCookCommand(fresh(), CookCommand.READ_ALOUD);
  assert.equal(s.readAloud, true);
  const again = applyCookCommand(s, CookCommand.READ_ALOUD);
  assert.equal(again.readAloud, true);
  assert.equal(again.speakToken, s.speakToken + 1);
});
test('"stop reading" only stops reading', () => {
  const reading = applyCookCommand(fresh(), CookCommand.READ_ALOUD);
  const stopped = applyCookCommand(reading, CookCommand.STOP_READING);
  assert.equal(stopped.readAloud, false);
  assert.equal(stopped.stepIndex, reading.stepIndex);
});
test('"start timer" uses this step\'s first stated duration', () => {
  const s = applyCookCommand(fresh(), CookCommand.START_TIMER);
  assert.equal(s.timer.totalSeconds, 120);
});
test('"start timer" on a step with no stated duration starts nothing', () => {
  const onStepTwo = nextStep(fresh());
  assert.equal(applyCookCommand(onStepTwo, CookCommand.START_TIMER).timer, null);
});
test('"stop timer" cancels a running one', () => {
  const running = applyCookCommand(fresh(), CookCommand.START_TIMER);
  assert.equal(applyCookCommand(running, CookCommand.STOP_TIMER).timer, null);
});
test('"stop listening" turns hands-free off and nothing else', () => {
  const listening = setHandsFree(fresh(), true);
  const stopped = applyCookCommand(listening, CookCommand.STOP_LISTENING);
  assert.equal(stopped.handsFree, false);
  assert.equal(stopped.stepIndex, listening.stepIndex);
});
test('an unrecognised command leaves the session exactly as it was', () => {
  const s = fresh();
  assert.equal(applyCookCommand(s, null), s);
  assert.equal(applyCookCommand(s, 'SEASON_TO_TASTE'), s);
});
