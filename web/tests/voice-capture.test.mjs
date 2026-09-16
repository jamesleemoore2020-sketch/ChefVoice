import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTranscriptSegment } from '../js/voice-capture.js';

// Real device capture (Chrome desktop, Windows, continuous+interim
// SpeechRecognition): a single spoken sentence with no natural pause got
// re-finalized roughly once per word as it grew, producing ~20 overlapping
// "final" transcript segments for one utterance -- which then each got
// parsed independently into duplicated/garbled ingredients (e.g. "Salt of
// top ramen", a stray "In"). reconcileTranscriptSegment is the pure decision
// VoiceCapture#commit uses to collapse that growth back into one segment
// instead of appending each re-finalization as its own entry.

test('a brand new utterance with no relation to the previous one is appended', () => {
  assert.equal(reconcileTranscriptSegment('', 'add a teaspoon of salt'), 'append');
  assert.equal(reconcileTranscriptSegment('add a teaspoon of salt', 'now add the pepper'), 'append');
});

test('an exact repeat of the last commit is skipped', () => {
  assert.equal(reconcileTranscriptSegment('add a teaspoon of salt', 'add a teaspoon of salt'), 'skip');
});

test('ASR re-finalizing the same utterance as it grows replaces the previous segment', () => {
  assert.equal(reconcileTranscriptSegment('of top ramen add in a teaspoon', 'of top ramen add in a teaspoon of'), 'replace');
  assert.equal(
    reconcileTranscriptSegment('of top ramen add in a teaspoon of salt', 'of top ramen add in a teaspoon of salt and pepper'),
    'replace'
  );
});

test('a revision that drops measurement evidence keeps the earlier, more informative commit', () => {
  // "changes its mind" and loses "a teaspoon of" -- the earlier commit is strictly better, keep it.
  assert.equal(reconcileTranscriptSegment('add a teaspoon of salt and pepper', 'salt and pepper'), 'skip');
});

test('a revision that keeps the same measurement evidence while growing still replaces', () => {
  assert.equal(
    reconcileTranscriptSegment('add a teaspoon of salt', 'add a teaspoon of salt and pepper and let it cook'),
    'replace'
  );
});
