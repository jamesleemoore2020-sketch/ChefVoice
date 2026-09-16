# PWA Live signaling join fix — 0.4.1

Prepared September 12–13, 2026, against the handoff branch at
`b55098ae858668c0a22107c336d2774ad0dd0401`, with the Android 0.11.5 / 65
patch already applied. This is a separate PWA deployment.

## Report and diagnosis

James built and signed Android 0.11.5 / 65 and confirmed that Live now works
on Android. The iPhone viewer displayed:

> Live signaling error: Missing or insufficient permissions.

The deployed `https://chefvoice-d7fec.web.app/js/webrtc-live-viewer.js` was
downloaded and matched the committed 0.4.0 viewer byte for byte (SHA-256
`683d14b659d80df9c4bd012b5996dae4a73a63a64e32f8b1016365c2fe441695`).
Its `start()` registered the peer-document and host-candidate listeners
before writing the viewer's `JOINING` peer document.

The existing `livePeerViewer()` rule requires all of these:

- An authenticated viewer whose UID matches the peer document ID.
- An existing peer document whose `viewerUid` matches that UID.
- No block between the viewer and host.

Before the join write commits, the document needed for authorization is
missing. The emulator reproduces `permission-denied` for that listener.
Firestore terminates a listener after a permission error; creating the
document afterward does not restart it. See the
[Firebase listener-error documentation](https://firebase.google.com/docs/firestore/query-data/listen#handle_listen_errors).

This investigation used the repository's actual rules in the emulator. It
did not retrieve or change the project's deployed ruleset.

## Changes

- Wait for the join document write to be acknowledged before attaching either
  private listener. The initial snapshot still delivers an offer that the
  host wrote before the listener attached.
- Delete abandoned candidate documents while their parent still authorizes
  the viewer. Deleting only the parent left old `c000` candidate IDs behind;
  candidate updates are intentionally forbidden by the rules.
- When leaving during a join, wait for that write to settle before cleanup,
  and skip listener attachment. Ignore callbacks after the viewer stops.
- Sequence room leave/rejoin so old cleanup cannot delete the new peer.
- Report host-candidate listener and viewer-candidate write errors, which
  previously could fail silently.
- Bump the PWA package and service-worker cache to 0.4.1.

Android stays on 0.11.5 / 65. There is no Android source change or Play upload
in this patch. Firestore/Storage rules, App Check, Functions, billing, and the
deterministic cooking parser are unchanged.

## Verification

The new `rules-tests/pwa-live-viewer.test.js` executes the production browser
controller, linked to the real Firebase SDK and authenticated emulator
contexts. Only the WebRTC media engine is simulated: this tests the actual
signaling operations and authorization, not camera/audio transport.

Five new checks cover:

1. The rules reject a viewer listener before its join document exists.
2. The controller waits for the join write, then receives an early host offer,
   writes its answer, and exchanges ICE documents. An unrelated user remains
   unable to read the peer or host candidates.
3. Leaving during a pending join attaches no listeners and leaves no peer.
4. Rejoining removes abandoned candidates so their IDs can be reused.
5. A rejected join starts no listeners or media engine and reports the error.

The first check passed against the old client/rules. The other four failed
against the old controller and pass with this patch.

- `npm --prefix rules-tests test`: **42/42** (37 existing + 5 new).
- `npm --prefix web test`: **95/95**.
- Both changed browser JavaScript files pass `node --check`.

The rules test command now enables Node's VM module support so the browser
module can be linked to the emulator SDK without loading CDN imports. The
emulator's expected-denial logs are part of the negative tests, not failures.

Not verified here: real Android-to-iPhone audio/video, Safari playback, or
the deployed project's current rules. Those require the device retest below.

## Apply and deploy from Command Prompt

Download `ChefVoice-PWA-Live-0.4.1.patch` into Downloads. Run each command
separately, stopping on any error:

```bat
cd /d "C:\Users\james\ChefVoice\.claude\worktrees\chefvoice-2026-09-11-handoff-be3999"
git apply --check "C:\Users\james\Downloads\ChefVoice-PWA-Live-0.4.1.patch"
git apply "C:\Users\james\Downloads\ChefVoice-PWA-Live-0.4.1.patch"
DEPLOY_PWA.cmd
```

`DEPLOY_PWA.cmd` runs the PWA tests and deploys only `hosting:pwa` to project
`chefvoice-d7fec`. A successful deploy should finish with
`CHEFVOICE PWA DEPLOYED SUCCESSFULLY`.

To repeat the emulator checks locally, run `RUN_RULES_GATES.cmd`. That command
runs tests only; a rules deployment is not part of this fix.

## Device retest

1. After deployment succeeds, close the open ChefVoice PWA/Safari page and
   reopen [ChefVoice](https://chefvoice-d7fec.web.app/) online. Reload the page
   so Safari loads the updated viewer and service worker. Do not clear site
   data, which can remove locally saved cooking sessions.
2. Start a fresh Live on Android build 65 and choose Watch Live on the iPhone
   while signed in. Confirm the permissions error no longer appears.
3. Check video and tap the room's audio button to enable sound. Test chat and
   a reaction.
4. Leave the room and immediately rejoin the same broadcast to check cleanup.
5. If an error remains, record its exact text and confirm the Hosting deploy
   finished successfully before changing any server permissions.

Keep real-device results separate from the emulator results above. Do not
declare end-to-end playback verified until James confirms it.
