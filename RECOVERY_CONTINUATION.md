# Deleted-chat recovery continuation

The uploaded v0.4 source already contained the completed membership/social foundation that the deleted conversation had been building toward:

- Email/password membership
- Chef profiles
- Firestore Community feed
- Recipe publishing
- Likes/comments/follows/bookmarks
- Optional Firebase Storage uploads

The v0.4 project notes explicitly identified the next milestone as Go Live.

This v0.5 continuation therefore preserves v0.4 and adds the Live control plane instead of restarting the app.

## Files changed for v0.5

- `app/src/main/java/com/chefvoice/app/model/Models.kt`
  - Added `LiveSession` and `LiveComment`.
- `app/src/main/java/com/chefvoice/app/cloud/FirebaseSocialRepository.kt`
  - Active-live listener, host start/end, live comments and reactions.
- `app/src/main/java/com/chefvoice/app/ui/ChefAppState.kt`
  - Live state/listeners/actions.
- `app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt`
  - New Live tab, live hub and live room.
- `app/src/main/java/com/chefvoice/app/ui/LiveCameraPreview.kt`
  - Host CameraX preview and camera/microphone permission handling.
- `firestore.rules`
  - Live session/comment/reaction access rules.
- `app/build.gradle.kts`
  - Bumped to version `0.5.0` / version code `7`.
- Setup/status documentation updated for the new milestone.

## What remains before viewers see video

Firestore carries room state, chat and reactions, but it is not a low-latency video transport. The next code milestone is to connect a real live media layer to `LiveSession.id` so host camera/audio frames are published and viewer devices subscribe to them.
