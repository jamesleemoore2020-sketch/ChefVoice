// Port of app/.../util/CookCommands.kt. Keep the two in step.
//
// What a chef can say to drive the cook-along screen with their hands in a bowl. Matching is
// deliberately literal: a phrase either IS one of these commands or it is nothing. A kitchen is
// full of speech not addressed to the device, and a screen that jumps step mid-recipe is far
// worse than one that makes the chef say "next" twice.

export const CookCommand = Object.freeze({
  NEXT: 'NEXT',
  PREVIOUS: 'PREVIOUS',
  REPEAT: 'REPEAT',            // says the current step once
  READ_ALOUD: 'READ_ALOUD',    // turns continuous reading on
  STOP_READING: 'STOP_READING',
  START_TIMER: 'START_TIMER',
  STOP_TIMER: 'STOP_TIMER',
  STOP_LISTENING: 'STOP_LISTENING'
});

/**
 * Only reversible commands may fire on a partial recognition result. Anything that stops
 * something waits for a final result: a half-heard "stop" is the one mistake a chef cannot
 * undo by simply saying the word again.
 */
export const safeFromPartial = Object.freeze({
  NEXT: true, PREVIOUS: true, REPEAT: true, READ_ALOUD: true,
  STOP_READING: false, START_TIMER: false, STOP_TIMER: false, STOP_LISTENING: false
});

const exact = new Map();
const add = (command, phrases) => phrases.forEach(p => exact.set(p, command));
add(CookCommand.NEXT, ['next', 'next step', 'next one', 'go next', 'forward', 'continue', 'done']);
add(CookCommand.PREVIOUS, ['back', 'go back', 'previous', 'previous step', 'last step', 'back up']);
add(CookCommand.REPEAT, ['repeat', 'repeat that', 'say again', 'say that again', 'again', 'what was that']);
add(CookCommand.READ_ALOUD, [
  'read out loud', 'read it out loud', 'read aloud', 'read this out loud',
  'read the steps', 'read the step', 'start reading', 'read it to me', 'read'
]);
add(CookCommand.STOP_READING, ['stop reading', 'stop reading out loud', 'stop talking', 'quiet', 'be quiet']);
add(CookCommand.START_TIMER, ['start timer', 'set timer', 'start the timer', 'timer', 'start timer please']);
add(CookCommand.STOP_TIMER, ['stop timer', 'cancel timer', 'stop the timer', 'reset timer']);
add(CookCommand.STOP_LISTENING, ['stop listening', 'hands free off', 'stop hands free', 'chef voice stop']);

/** Phrases handed to the recognizer as hints where the browser supports grammars. */
export const biasingWords = [...exact.keys()];

const normalize = raw => String(raw ?? '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

/** The command in `heard`, or null when the chef was talking about something else. */
export function matchCommand(heard) {
  const clean = normalize(heard);
  if (!clean) return null;
  if (exact.has(clean)) return exact.get(clean);
  // One leading politeness marker is tolerated -- it is how people address a device.
  const stripped = clean
    .replace(/^chef voice /, '').replace(/^chefvoice /, '')
    .replace(/^ok /, '').replace(/^okay /, '').replace(/^please /, '')
    .trim();
  return exact.get(stripped) ?? null;
}
