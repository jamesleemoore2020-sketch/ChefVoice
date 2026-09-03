# ChefVoice Android 0.7.8 / PWA 0.12.3 — App Check Monitoring

Generated: 2026-08-14

## Purpose

Stage Firebase App Check without breaking the real-device-proven ChefVoice capture, parser, media, or second-pass pipeline. This is a monitoring candidate, not an enforcement release.

## Android

- Debug/sideload builds use Firebase App Check Debug Provider.
- Release builds use Play Integrity.
- No debug secret is stored in source or build scripts.
- On first debug run, Firebase generates a private debug secret in local Logcat. Register that secret in Firebase Console > App Check > Android app > Manage debug tokens. Never paste or commit it.
- Production Play Integrity registration still requires the Android app's SHA-256 certificate fingerprint in Firebase Console.

## PWA

- Uses Firebase App Check reCAPTCHA Enterprise provider when `appCheckConfig.siteKey` is populated.
- The repository intentionally ships with an empty site key; create/register the score-based Enterprise key for the production ChefVoice domains first.
- No web debug token is shipped to production.
- App Check SDK failure cannot stop local Cook & Capture.

## Backend

- `transcribeChefVoice` remains authenticated and explicitly sets `enforceAppCheck:false` during monitoring.
- Do not enable App Check enforcement until real-device Android and iPhone/PWA requests show VALID metrics.
- Existing Cloud Speech V2 / Chirp 3 configuration is unchanged.

## Protected architecture

No changes to deterministic cooking parsing, original/private audio handling, correction review, iPhone hard media isolation, or the already accepted method-review/idempotency logic.
