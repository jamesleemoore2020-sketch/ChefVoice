# ChefVoice PWA 0.9 — Offline / Cloud Sync Queue

## Goal
Cooking must remain local-first. Publishing should survive weak/no internet without duplicate recipes.

## New recipe sync states
- LOCAL_ONLY
- QUEUED
- UPLOADING
- SYNCED

## Behavior
- Publish/unpublish intent is written locally before network work starts.
- One idempotent queue operation exists per recipe.
- Opposite intent (for example Publish then Unpublish) replaces the stale queued action.
- Same recipe ID is reused on every attempt.
- Same media IDs/storage paths are reused on retry.
- Failed uploads use exponential retry backoff from 5 seconds up to 5 minutes.
- Queue wakes when:
  - the user signs in
  - the browser comes back online
  - user taps Sync now
  - ChefVoice remains open (15-second foreground check)
- Queue operations are bound to the ChefVoice account that created them.
- Deleting a local recipe clears its queued cloud operation.

## Media safety
A recipe does not become public until all public photo/video uploads have succeeded.
Private raw chef voice can remain queued separately without exposing it publicly.

## Scope
This is a foreground retry queue. Safari/iOS cannot be assumed to run arbitrary sync work after the PWA has been fully closed. The queue persists and resumes the next time ChefVoice is opened/online.

## Intentionally unchanged
- v0.7.3 iPhone media-isolation behavior
- deterministic ingredient parser
- hands-free command behavior
- two-way WebRTC Live
- Firestore rules
- Storage rules
- Android native app
