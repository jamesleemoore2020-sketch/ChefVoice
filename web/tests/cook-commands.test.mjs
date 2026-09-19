import test from 'node:test';
import assert from 'node:assert/strict';
import { CookCommand as C, matchCommand as m, safeFromPartial, biasingWords } from '../js/cook-commands.js';

// Port of CookCommandsTest.kt. The expensive mistake is a false positive: a screen that jumps
// step mid-recipe is far worse than one that makes the chef say "next" twice.

test('matches the commands a chef would say', () => {
  assert.equal(m('next'), C.NEXT);
  assert.equal(m('next step'), C.NEXT);
  assert.equal(m('go back'), C.PREVIOUS);
  assert.equal(m('say that again'), C.REPEAT);
  assert.equal(m('read out loud'), C.READ_ALOUD);
  assert.equal(m('stop reading'), C.STOP_READING);
  assert.equal(m('start timer'), C.START_TIMER);
  assert.equal(m('cancel timer'), C.STOP_TIMER);
  assert.equal(m('stop listening'), C.STOP_LISTENING);
});
test('ignores case and punctuation', () => {
  assert.equal(m('Next!'), C.NEXT);
  assert.equal(m('  NEXT  STEP  '), C.NEXT);
  assert.equal(m('Repeat, that.'), C.REPEAT);
});
test('tolerates one leading politeness marker', () => {
  assert.equal(m('ok next'), C.NEXT);
  assert.equal(m('chef voice next step'), C.NEXT);
  assert.equal(m('please go back'), C.PREVIOUS);
});
test('ignores a command word buried in narration', () => {
  assert.equal(m('the next thing you want to do is add the garlic'), null);
  assert.equal(m('back in the pan with the onions'), null);
  assert.equal(m('repeat this with the second batch'), null);
  assert.equal(m('give the timer another few minutes'), null);
});
test('ignores everyday kitchen speech', () => {
  assert.equal(m('can you pass me the salt'), null);
  assert.equal(m('that smells amazing'), null);
  assert.equal(m(''), null);
  assert.equal(m('   '), null);
});
test('read-aloud is its own command, separate from repeat', () => {
  for (const p of ['read out loud', 'read it out loud', 'read aloud', 'start reading', 'read the steps']) assert.equal(m(p), C.READ_ALOUD, p);
  assert.equal(m('repeat'), C.REPEAT);
  for (const p of ['stop reading', 'be quiet', 'stop talking']) assert.equal(m(p), C.STOP_READING, p);
});
test('reading commands are still ignored inside narration', () => {
  assert.equal(m('read the recipe before you start cooking'), null);
  assert.equal(m('i read that somewhere'), null);
});
test('only reversible commands may fire on a partial result', () => {
  for (const k of ['NEXT', 'PREVIOUS', 'REPEAT', 'READ_ALOUD']) assert.equal(safeFromPartial[k], true, k);
  for (const k of ['STOP_READING', 'START_TIMER', 'STOP_TIMER', 'STOP_LISTENING']) assert.equal(safeFromPartial[k], false, k);
});
test('every command has biasing words', () => {
  for (const command of Object.values(C)) assert.ok(biasingWords.some(w => m(w) === command), `no phrase for ${command}`);
});
