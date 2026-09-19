// Port of CookingScreen's state handling in app/.../ui/ChefVoiceApp.kt. Keep the two in step.
//
// The cook-along screen shows one method step at a time to a chef whose hands are in a bowl.
// All of its state lives here as plain data so the behaviour -- what "next" does at the last
// step, when a timer may start, when a step is spoken again -- can be tested without a browser,
// and so the screen itself is only a drawing of this state.
//
// Nothing here edits the recipe. A cook-along is a way of reading a recipe, never of changing
// one; the saved recipe is exactly what the chef narrated, before and after cooking from it.

import { CookCommand } from './cook-commands.js';
import { timersIn } from './step-timers.js';

/**
 * `speakToken` is bumped every time the current step should be said out loud again --
 * including when the chef asks to repeat a step they are already on, which a plain check on
 * `stepIndex` cannot detect because the index has not changed.
 */
export function initialCookState(steps) {
  return {
    steps: (steps || []).map(s => String(s ?? '')),
    stepIndex: 0,
    readAloud: false,
    handsFree: false,
    timer: null,
    speakToken: 0
  };
}

export const currentStep = state => state.steps[state.stepIndex] ?? '';

/** The durations the chef actually stated in this step. A step with none simply has no timer. */
export const timersForStep = state => timersIn(currentStep(state));

export function goToStep(state, index) {
  const last = state.steps.length - 1;
  const clamped = Math.min(Math.max(index, 0), Math.max(last, 0));
  if (clamped === state.stepIndex) return state;
  return { ...state, stepIndex: clamped, speakToken: state.speakToken + 1 };
}

export const nextStep = state => goToStep(state, state.stepIndex + 1);
export const previousStep = state => goToStep(state, state.stepIndex - 1);

/** Says the current step again without moving. */
export const repeatStep = state => ({ ...state, speakToken: state.speakToken + 1 });

export function setReadAloud(state, on) {
  if (state.readAloud === on) return state;
  // Turning reading on should say the step the chef is looking at now, not wait for the
  // next one.
  return { ...state, readAloud: on, speakToken: on ? state.speakToken + 1 : state.speakToken };
}

export const setHandsFree = (state, on) => (state.handsFree === on ? state : { ...state, handsFree: on });

export function startTimer(state, timer) {
  if (!timer || !(timer.totalSeconds > 0)) return state;
  return {
    ...state,
    timer: {
      label: timer.label,
      totalSeconds: timer.totalSeconds,
      remainingSeconds: timer.totalSeconds,
      paused: false,
      finished: false
    }
  };
}

export const clearTimer = state => (state.timer ? { ...state, timer: null } : state);

export function toggleTimerPause(state) {
  if (!state.timer || state.timer.finished) return state;
  return { ...state, timer: { ...state.timer, paused: !state.timer.paused } };
}

/** One second of a running timer. A paused, finished or absent timer is left alone. */
export function tickTimer(state) {
  const timer = state.timer;
  if (!timer || timer.paused || timer.finished) return state;
  const remaining = Math.max(0, timer.remainingSeconds - 1);
  return { ...state, timer: { ...timer, remainingSeconds: remaining, finished: remaining === 0 } };
}

/**
 * Applies a spoken command. Mirrors CookingScreen's `handleCommand`: every command is either
 * a move the chef could have made with a button, or nothing at all.
 */
export function applyCookCommand(state, command) {
  switch (command) {
    case CookCommand.NEXT: return nextStep(state);
    case CookCommand.PREVIOUS: return previousStep(state);
    // Repeat says the current step again; it does not double as the way to switch reading on,
    // which is what "read out loud" is for.
    case CookCommand.REPEAT: return repeatStep(state);
    case CookCommand.READ_ALOUD: return state.readAloud ? repeatStep(state) : setReadAloud(state, true);
    case CookCommand.STOP_READING: return setReadAloud(state, false);
    case CookCommand.START_TIMER: {
      const timer = timersForStep(state)[0];
      return timer ? startTimer(state, timer) : state;
    }
    case CookCommand.STOP_TIMER: return clearTimer(state);
    case CookCommand.STOP_LISTENING: return setHandsFree(state, false);
    default: return state;
  }
}
