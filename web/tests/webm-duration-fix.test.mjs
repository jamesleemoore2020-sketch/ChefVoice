import test from 'node:test';
import assert from 'node:assert/strict';
import { fixWebmDuration } from '../js/webm-duration-fix.js';

// Chrome's MediaRecorder writes WebM with no real Duration -- confirmed via
// Cloud Function logs as the cause of both a client/server duration mismatch
// and an outright "unsupported encoding" rejection from the Chirp 3 backend
// (RUNON_TRANSCRIPT_DUPLICATION follow-up). These build minimal, independent
// EBML byte fixtures (not derived from the library under test) for the two
// shapes Chrome's output takes -- an invalid (zero) Duration, and no Duration
// element at all -- and decode the patched result with a plain DataView, so
// the test is a real oracle on the on-disk bytes, not just round-tripping
// through the same code being tested.

// EBML variable-length integer: `bytes` extra bytes after the marker byte.
function vint(value, bytes) {
  const out = new Uint8Array(1 + bytes);
  out[0] = (1 << (7 - bytes)) | (value >>> (8 * bytes));
  for (let i = 0; i < bytes; i++) out[1 + bytes - 1 - i] = (value >>> (8 * i)) & 0xff;
  return out;
}
function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}
// TimecodeScale (canonical id 0x2AD7B1) = 1,000,000 (1ms per unit).
function timecodeScaleBytes() {
  return concatBytes([new Uint8Array([0x2a, 0xd7, 0xb1]), vint(3, 0), new Uint8Array([0x0f, 0x42, 0x40])]);
}
// Duration (canonical id 0x4489), an 8-byte float payload.
function durationBytes(value) {
  const payload = new Uint8Array(8);
  new DataView(payload.buffer).setFloat64(0, value, false);
  return concatBytes([new Uint8Array([0x44, 0x89]), vint(8, 0), payload]);
}
// Minimal-width size VINTs, matching what any real muxer (and this library's own
// writer) would produce for these small sizes -- a non-minimal-width VINT is
// technically legal EBML, but the library always re-canonicalizes to minimal
// width on write, which would make the "unchanged byte layout" case below
// falsely look like a resize if the fixture didn't already match it.
function segmentBytes(infoContent) {
  const info = concatBytes([new Uint8Array([0x15, 0x49, 0xa9, 0x66]), vint(infoContent.length, 0), infoContent]);
  return concatBytes([new Uint8Array([0x18, 0x53, 0x80, 0x67]), vint(info.length, 0), info]);
}
// Locates the 8-byte float payload of a "44 89 88" (Duration id + 8-byte-length
// marker) run in raw bytes, independent of where the rest of the fixture puts it.
function findDurationPayloadOffset(bytes) {
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x44 && bytes[i + 1] === 0x89 && bytes[i + 2] === 0x88) return i + 3;
  }
  return -1;
}

test('an invalid (zero) Duration is patched in place, byte layout unchanged', async () => {
  const info = concatBytes([timecodeScaleBytes(), durationBytes(0)]);
  const original = segmentBytes(info);
  const blob = new Blob([original], { type: 'audio/webm' });

  const fixed = await fixWebmDuration(blob, 12345, { logger: false });
  const bytes = new Uint8Array(await fixed.arrayBuffer());

  assert.equal(bytes.length, original.length, 'patching an existing 8-byte float must not resize the file');
  const at = findDurationPayloadOffset(bytes);
  assert.ok(at >= 0, 'Duration element must still be present in the output');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getFloat64(at, false), 12345);
});

test('a missing Duration element is appended and still parses back correctly', async () => {
  const info = timecodeScaleBytes();
  const original = segmentBytes(info);
  const blob = new Blob([original], { type: 'audio/webm;codecs=opus' });

  const fixed = await fixWebmDuration(blob, 6789, { logger: false });
  const bytes = new Uint8Array(await fixed.arrayBuffer());

  assert.ok(bytes.length > original.length, 'appending Duration must grow the file');
  const at = findDurationPayloadOffset(bytes);
  assert.ok(at >= 0, 'Duration element must be present in the output');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getFloat64(at, false), 6789);
});

test('a non-WebM/unparseable blob is returned unchanged rather than corrupted', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mp4' });
  const fixed = await fixWebmDuration(blob, 1000);
  assert.equal(fixed, blob);
});
