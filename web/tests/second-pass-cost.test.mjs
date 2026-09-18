import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SecondPassLimits } from '../js/entitlement.js';

// Cost gates for ChefVoice Review.
//
// Two things decide what a review costs: how much audio is sent to Chirp 3, which is
// billed per minute, and whether the uploaded object is left behind in Cloud Storage
// afterwards. Both regressed silently and invisibly -- nothing in the app breaks if
// the cap creeps back up or the delete is dropped, the bill just grows -- so they are
// pinned here.
//
// The cap assertions run against the real module. The rest are source-text gates:
// these tests cannot talk to Firebase Storage, so they check that the client still
// contains the shapes that do the right thing, in the same spirit as
// notifications/*.test.js on the Android side.

const client = readFileSync(new URL('../js/firebase-client.js', import.meta.url), 'utf8');
const androidModels = readFileSync(
  new URL('../../app/src/main/java/com/chefvoice/app/model/Models.kt', import.meta.url),
  'utf8'
);
const androidRepo = readFileSync(
  new URL('../../app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt', import.meta.url),
  'utf8'
);

test('one review sends at most five minutes of audio', () => {
  assert.equal(SecondPassLimits.MAX_REVIEW_DURATION_MS, 5 * 60 * 1000);
  assert.equal(SecondPassLimits.MAX_REVIEW_MINUTES, 5);
});

test('Android pins the same review ceiling as the PWA', () => {
  // The two parsers share a corpus; these two clients share a bill. A cap raised on
  // one platform only would double the cost of the same feature depending on which
  // app the chef happens to open.
  assert.match(androidModels, /object SecondPassLimits \{/);
  assert.match(androidModels, /const val MAX_REVIEW_DURATION_MS = 5L \* 60L \* 1000L/);
  assert.match(androidModels, /const val MAX_REVIEW_MINUTES = MAX_REVIEW_DURATION_MS \/ 60_000L/);
});

test('the review path gates on the review ceiling, not the storage one', () => {
  assert.match(client, /if\(durationMs>SecondPassLimits\.MAX_REVIEW_DURATION_MS\)/);
  assert.match(androidRepo, /if \(durationMs > SecondPassLimits\.MAX_REVIEW_DURATION_MS\) \{/);
});

test('the publish path keeps its own, larger storage ceiling', () => {
  // Publishing writes the private cloud copy without transcribing it, so it costs
  // storage but no speech time. Collapsing the two ceilings back into one would
  // either make reviews expensive again or stop long sessions being published.
  assert.match(client, /const PRIVATE_SESSION_MAX_DURATION_MS=90\*60\*1000;/);
  assert.match(client, /if\(durationMs<=0\|\|durationMs>PRIVATE_SESSION_MAX_DURATION_MS\)/);
  assert.match(androidRepo, /private const val PRIVATE_SESSION_MAX_DECLARED_DURATION_MS = 90L \* 60L \* 1000L/);
  assert.match(androidRepo, /durationMs > PRIVATE_SESSION_MAX_DECLARED_DURATION_MS/);
});

test('the too-long message names the limit and the actual length', () => {
  // A bare "too long" leaves a chef with no idea whether they are ten seconds over
  // or an hour, and no reason to believe their recording survived.
  assert.match(client, /function secondPassTooLongMessage\(durationMs\)\{/);
  assert.match(client, /SecondPassLimits\.MAX_REVIEW_MINUTES/);
  assert.match(client, /Math\.ceil\(durationMs\/60000\)/);
  assert.match(client, /The original local audio is unchanged and still plays back in full\./);
  assert.match(androidRepo, /private fun secondPassTooLongMessage\(durationMs: Long\): String \{/);
});

test('the uploaded audio is released once the review has finished with it', () => {
  // The object exists only to hand one recording to Chirp 3; nothing reads it again.
  // Leaving it behind was a standing storage charge per reviewed recipe.
  assert.match(client, /async function releasePrivateSessionAudio\(target\)\{/);
  assert.match(client, /await deleteObject\(target\)/);
  assert.match(androidRepo, /private fun releasePrivateSessionAudio\(ref: StorageReference\) \{/);
  assert.match(androidRepo, /runCatching \{ ref\.delete\(\) \}/);
});

test('the release runs whether the review succeeded or failed', () => {
  // A failed transcription leaves exactly the same orphaned object as a successful
  // one, so the cleanup cannot live only on the happy path. On the PWA that is a
  // finally block; on Android it is a call in each of the three terminal branches.
  assert.match(client, /\}finally\{\r?\n\s*await releasePrivateSessionAudio\(target\);\r?\n\s*\}/);
  const androidReleases = androidRepo.match(/releasePrivateSessionAudio\(target\)/g) || [];
  assert.ok(
    androidReleases.length >= 3,
    `expected the Android review to release the object on success, unreadable response and failure; found ${androidReleases.length}`
  );
});

test('deleting the object never turns into an error the chef sees', () => {
  // Cleanup is a cost concern, not a correctness one. A failed delete must not fail
  // a review that already produced a usable transcript.
  assert.match(client, /catch\(_\)\{\/\* cost, not correctness \*\/\}/);
  assert.match(androidRepo, /runCatching \{ ref\.delete\(\) \}/);
});

test('the storage rules still let the owner delete what the client uploaded', () => {
  // The cleanup relies on this permission. If the rule were tightened to
  // `allow delete: if false`, every review would silently start leaking again.
  const storageRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
  assert.match(
    storageRules,
    /match \/privateVoice\/\{uid\}\/\{recipeId\}\/\{fileName\} \{[\s\S]*?allow delete: if privateRecipeOwnedBy\(uid, recipeId\) && fileName == 'session';/
  );
});
