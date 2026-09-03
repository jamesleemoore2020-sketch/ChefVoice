# ChefVoice Android v0.8.9 — Cleaner Notifications

This is a focused UI cleanup on top of v0.8.8 Notification Preferences.

- Notification activity remains front-and-center.
- Notification settings are collapsed by default.
- The collapsed row shows how many of the four activity alert types are enabled.
- Expanding it exposes Messages, Comments, Likes, and Followed-chef Live switches.
- Redundant Community and Profile buttons were removed from Notifications because Android's primary bottom bar already contains those destinations.
- Signed-out Notifications explains that sign-in lives in the Profile tab without adding a duplicate navigation button.
- No backend notification semantics, Firebase IAM, Firestore/Storage rules, App Check enforcement, deterministic parser, Second Pass, raw audio, or Live media/WebRTC behavior is changed.
