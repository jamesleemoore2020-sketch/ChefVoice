# Android audit fixes (0.11.18, versionCode 79)

Android's share of the 2026-09-26 full audit. This build is **not released**: nothing here has
been built for release, signed or uploaded. Items are added as they land.

**Not touched:** the parser (`voice/`) and the golden corpus, `firestore.rules`,
`storage.rules`, every Functions codebase, `transcribeChefVoice`, Live signaling, App Check.

## F5 — threads show their newest messages, not their oldest

Direct messages, recipe comments and Live chat each listened with
`orderBy("createdAt").limit(n)`, which returns the **oldest** n. Once a thread passed its cap
— 250 messages, 100 comments, 150 Live comments — new items were silently never shown, and a
busy Live lost its chat at comment 151. All three now use `limitToLast(n)`, which keeps the
newest n, still oldest-first, so nothing on screen changes order. The PWA made the same fix in
0.5.18 with the same three windows, and `web/tests/thread-windows.test.mjs` holds both
platforms to them. No rules change: the rules constrain these reads by path, not by limit.
