> **Correction (PWA_LIVE_VIEWER_0.4.0.md, 2026-09-12):** this document describes a
> PWA build that was never actually committed to this repository -- there is no
> "iPhone host" code anywhere in `web/js/` and no evidence one was ever built.
> Treat everything below as aspirational, not historical fact. As of
> PWA_LIVE_VIEWER_0.4.0.md the PWA can watch an Android host (viewer-only);
> hosting a Live from an iPhone, which is this entire document's subject, does
> not exist yet.

# ChefVoice PWA v0.6 — iPhone Host → Android Viewer Test

## What changed

The previously validated direction remains:

- Android host → iPhone viewer ✅ real-device confirmed

This build adds:

- iPhone host → Android viewer

It deliberately reuses the Android WebRTC signaling contract rather than creating a second protocol.

## Deploy the new PWA

From the extracted `web` folder:

```bat
firebase deploy --only hosting --project chefvoice-d7fec
```

Hosting URL remains:

`https://chefvoice-d7fec.web.app`

Close/reopen the iPhone Home Screen app after deployment. The top badge should say:

`PWA 0.6 · Two-Way Live`

## First reverse test

Use two different ChefVoice accounts if possible.

- iPhone host: Account A
- Android viewer: Account B

Put both phones on the same Wi-Fi for the first test.

### iPhone

1. Open ChefVoice PWA.
2. Sign in.
3. Open **Live**.
4. Under **Go Live from iPhone**, enter a title.
5. Tap **Go Live from iPhone**.
6. Allow Camera and Microphone.
7. Expected status: `LIVE from iPhone · waiting for viewers`.

### Android

1. Open native ChefVoice.
2. Sign in with the second account.
3. Open **Live**.
4. The iPhone Live room should appear in the active Live list.
5. Open/watch that room.
6. Android should progress through its existing viewer connection and show the iPhone camera + audio.

## While connected

On iPhone verify:

- Viewer count becomes 1.
- **Flip camera** changes front/back camera while preserving the stream.
- **Mute mic** removes host audio; **Unmute** restores it.
- Live comments from Android appear.
- Reaction counts update.

On Android verify:

- iPhone video is visible.
- iPhone microphone audio is audible.
- Chat/reactions work.
- Ending Live on iPhone closes the room.

## If Android sees the room but video stays connecting

Keep both phones on the same Wi-Fi and retry once.

If same-Wi-Fi works but Wi-Fi ↔ cellular fails, add a TURN relay. Do not change the recipe voice/ingredient parser to troubleshoot Live.

## If iPhone camera/microphone does not open

- Confirm ChefVoice is loaded from the HTTPS Firebase Hosting URL.
- In iPhone Settings/Safari site permissions, allow camera and microphone for ChefVoice.
- Close/reopen the Home Screen web app and retry from the explicit Go Live button.

## Protected feature verification

Parser regression suite at packaging: **20/20 passing**.

Live did not modify the Cook & Capture voice, ingredient, or cooking-session parser files.
