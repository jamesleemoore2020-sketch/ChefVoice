import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ICE_CANDIDATES_PER_SIDE, candidateFromDoc, candidateToDoc, iceCandidateDocumentId, isFreshLiveSession
} from '../js/webrtc-signaling.js';

test('iceCandidateDocumentId zero-pads to match validIceCandidate()\'s c0xx pattern', () => {
  assert.equal(iceCandidateDocumentId(0), 'c000');
  assert.equal(iceCandidateDocumentId(7), 'c007');
  assert.equal(iceCandidateDocumentId(63), 'c063');
});

test('iceCandidateDocumentId refuses out-of-range or non-integer sequence numbers', () => {
  assert.equal(iceCandidateDocumentId(64), null);
  assert.equal(iceCandidateDocumentId(MAX_ICE_CANDIDATES_PER_SIDE), null);
  assert.equal(iceCandidateDocumentId(-1), null);
  assert.equal(iceCandidateDocumentId(1.5), null);
});

test('candidateToDoc coerces a null sdpMid to an empty string, matching Android', () => {
  const doc = candidateToDoc({ sdpMid: null, sdpMLineIndex: 0, candidate: 'candidate:1 1 UDP 1 1.1.1.1 1 typ host' });
  assert.equal(doc.sdpMid, '');
  assert.equal(doc.sdpMLineIndex, 0);
  assert.equal(typeof doc.createdAt, 'number');
});

test('candidateFromDoc round-trips a candidateToDoc() result', () => {
  const original = { sdpMid: 'audio', sdpMLineIndex: 1, candidate: 'candidate:1 1 UDP 1 1.1.1.1 1 typ host' };
  const doc = candidateToDoc(original);
  const restored = candidateFromDoc(doc);
  assert.deepEqual(restored, { sdpMid: 'audio', sdpMLineIndex: 1, candidate: original.candidate });
});

test('candidateFromDoc turns a blank sdpMid back into null, matching Android\'s candidateFrom()', () => {
  const restored = candidateFromDoc({ sdpMid: '', sdpMLineIndex: 0, candidate: 'candidate:1 1 UDP 1 1.1.1.1 1 typ host' });
  assert.equal(restored.sdpMid, null);
});

test('candidateFromDoc rejects a doc with no candidate string or a non-integer line index', () => {
  assert.equal(candidateFromDoc({ sdpMid: 'a', sdpMLineIndex: 0, candidate: '' }), null);
  assert.equal(candidateFromDoc({ sdpMid: 'a', sdpMLineIndex: 0 }), null);
  assert.equal(candidateFromDoc({ sdpMid: 'a', candidate: 'x' }), null);
});

test('isFreshLiveSession follows the 35s heartbeat lease used for the discovery list', () => {
  const now = 1_000_000;
  assert.equal(isFreshLiveSession({ status: 'LIVE', heartbeatAt: now - 34000 }, now), true);
  assert.equal(isFreshLiveSession({ status: 'LIVE', heartbeatAt: now - 36000 }, now), false);
});

test('isFreshLiveSession falls back to the 90s legacy grace window when heartbeatAt is unset', () => {
  const now = 1_000_000;
  assert.equal(isFreshLiveSession({ status: 'LIVE', heartbeatAt: 0, startedAt: now - 89000 }, now), true);
  assert.equal(isFreshLiveSession({ status: 'LIVE', heartbeatAt: 0, startedAt: now - 91000 }, now), false);
});

test('isFreshLiveSession rejects anything not currently LIVE', () => {
  assert.equal(isFreshLiveSession({ status: 'ENDED', heartbeatAt: Date.now() }), false);
  assert.equal(isFreshLiveSession({ status: 'STARTING', heartbeatAt: Date.now() }), false);
  assert.equal(isFreshLiveSession(null), false);
});
