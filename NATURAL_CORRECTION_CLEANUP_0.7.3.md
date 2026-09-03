# ChefVoice Android 0.7.3 / PWA 0.11.8 — Natural Correction Cleanup

Real Android evidence:

`1 lb of ground beef, wait, 2 lb of ground beef.`

Expected final ingredient:

`2 lb Ground beef`

Fixes:
- recognizes `wait`, `no`, `sorry`, and `actually no` as correction cues only when immediately followed by a measured ingredient
- replaces older quantities of that same ingredient instead of retaining both
- trims trailing ASR fragments such as `like` / `wait` from ingredient names
- Second Pass matching prioritizes exact name + exact measurement
- stale old quantities are shown as `Superseded quantity` with explicit removal instead of generic Live-only ingredient
- raw Cooking transcript remains untouched as evidence
- mirrored on Android and PWA

This build is a candidate until verified on the user's real Android device.
