# ChefVoice Web Firebase Status — Alpha 3

Updated: 2026-08-12

## Verified backend

- Firebase project: `chefvoice-d7fec`
- Web app registered in the same project as Android
- Email/Password Authentication: enabled
- Firestore rules: verified against the Android source rules
- Firebase Storage: enabled on Blaze and Storage rules published

## Web/PWA features now enabled

- Existing account sign-in
- New Email/Password account creation
- Profile read/edit sync
- Public Community recipe feed
- Publish and unpublish local PWA recipes
- Photo/video upload to the Android-compatible recipe Storage path
- Full cooking-session voice upload to the Android-compatible recipe Storage path
- Likes
- Bookmarks
- Follow/unfollow
- Recipe comments

## Protected voice gate

The ingredient parser and cooking-session parser were not changed while enabling Firebase writes. The browser parser regression suite remains 20/20 passing.

Microphone capture, live speech recognition, transcript recovery and local original-audio storage remain independent of Firebase. A Firebase outage therefore does not disable local cooking capture.

## Still gated

Android ↔ iPhone WebRTC Live remains intentionally disabled in the PWA until real-device signaling/media/reconnection tests are complete.

## Pre-production hardening still recommended

Before broad public release, tighten Storage rules with file size/content-type limits and perform abuse/cost testing. The current rules are appropriate for the private alpha but intentionally match the Android storage path/ownership model rather than introducing a schema change during the iPhone port.

## Live v0.6 additions

The web Firebase client now also supports creating/ending Live sessions and host-side WebRTC signaling (`observeLivePeers`, host offer writes, host ICE writes, and host peer cleanup). These operations use the already-published `/liveSessions` Firestore rules; no rule change was required for the reverse-direction alpha.
