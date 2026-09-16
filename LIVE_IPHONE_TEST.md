> **Current status (2026-09-14):** PWA hosting and viewing are implemented in candidate 0.5.0. Android hosting and the earlier iPhone viewer fix were confirmed by James; new iPhone hosting is locally tested only and needs deployment/device verification. See [PWA Go Live 0.5.0](PWA_GO_LIVE_0.5.0.md) and [current handoff](HANDOFF_2026-09-14.md). Older version claims and viewer-only instructions below are historical and superseded.

> **Correction (PWA_LIVE_VIEWER_0.4.0.md, 2026-09-12):** this document describes a
> PWA build that was never actually committed to this repository. `git log -- web/`
> has no Live/WebRTC-related PWA commit before 0.4.0, and `web/js/` had zero
> `RTCPeerConnection`/`liveSessions`/`getUserMedia` code until then — the PWA's
> Live tab was a static "remains intentionally gated" placeholder the whole time.
> Treat the "✅ real-device confirmed" claims and status-progression steps below
> as aspirational, not historical fact. See `PWA_LIVE_VIEWER_0.4.0.md` for what
> actually shipped (viewer-only; the two-way/host-from-iPhone step this doc
> describes still does not exist).

# ChefVoice PWA v0.5 — Android Host → iPhone Viewer Test

## What this build enables

- Android ChefVoice app hosts the existing WebRTC Live.
- iPhone PWA lists active Android Live rooms.
- Signed-in iPhone user taps **Watch Live**.
- Android sends its camera + microphone through WebRTC.
- Firestore carries only offer/answer/ICE signaling.
- iPhone can react and use Live chat.
- If iOS blocks audio autoplay, tap **Enable audio**.

## First test setup

Use two DIFFERENT ChefVoice accounts.

- Android: account A
- iPhone: account B

Put both phones on the same Wi-Fi for the first test.

## Android

1. Open native ChefVoice.
2. Sign in.
3. Open **Live**.
4. Enter a title.
5. Tap **Go Live**.
6. Wait for Android to show:
   `LIVE video ready · waiting for viewers`

## iPhone

1. Open the ChefVoice Home Screen PWA.
2. Confirm the badge says:
   `PWA 0.5 · Live Alpha`
3. Sign in with a different ChefVoice account.
4. Open **Live**.
5. The Android live room should appear automatically.
6. Tap **Watch Live**.
7. Expected status progression:
   - Joining live video…
   - Host found · negotiating live video…
   - Connecting live video…
   - Watching LIVE video
8. If picture appears but sound does not, tap **Enable audio**.

## Also test

- Heart / fire / clap reaction
- Live comment from iPhone
- Leave stream
- Rejoin
- End Live on Android

## If the room does not appear

Confirm Android really created a `LIVE` session and both apps use Firebase project:

`chefvoice-d7fec`

## If it says signaling / permission denied

Recheck the published Firestore rules from the handoff. The `/liveSessions/{sessionId}/peers/...` rules must be present.

## If it reaches Connecting but never shows video

Keep both phones on the same Wi-Fi and retry once.

If same-Wi-Fi works but Wi-Fi ↔ cellular later fails, the peer-to-peer media path needs a TURN relay. Do not change the ingredient parser to troubleshoot Live.

## Protected feature

This Live build does not modify:

- `voice-capture.js`
- `ingredient-parser.js`
- `cooking-session-parser.js`

Parser regression result at packaging: **20/20 passing**.
