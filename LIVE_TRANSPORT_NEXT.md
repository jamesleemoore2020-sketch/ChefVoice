# v0.6 Live transport integration target

v0.5 provides the stable Community control plane. The next media layer should use the existing Firestore live session ID as its room/channel key.

A transport integration should provide these behaviors:

- Host publishes camera + microphone to `session.id`.
- Viewers subscribe using the same `session.id`.
- Host can switch front/back cameras and mute microphone.
- Viewer join/leave presence is exposed to the UI.
- Transport credentials/tokens are generated securely outside the Android client when required.
- Ending the Firestore session also stops the media publication.
- A completed broadcast can optionally be recorded/archived and its replay URL attached to the session.
- Replay completion can trigger ChefVoice's existing transcript/recipe pipeline to create a draft recipe.

Do not place provider admin secrets or server signing keys in the Android APK.
