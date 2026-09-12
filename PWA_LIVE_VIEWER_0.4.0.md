# ChefVoice PWA — Live viewer (0.4.0)

Before this change the PWA's Live tab was a static placeholder
(`web/js/app.js`'s `liveTemplate()`) reading "Live remains intentionally
gated" -- no signaling, no camera, no Firestore wiring at all, despite three
root-level docs (`WEBRTC_LIVE_SETUP.md`'s "PWA iPhone viewer"/"PWA two-way
Live extension" sections, `LIVE_IPHONE_TEST.md`, `LIVE_TWO_WAY_TEST.md`)
describing a working PWA viewer and even an iPhone-hosting build in detail,
with "✅ real-device confirmed" language. `git log -- web/` has no Live/WebRTC
commit before this one, and `web/js/` had zero `RTCPeerConnection`/
`liveSessions`/`getUserMedia` code until now -- those three docs were never
backed by real code in this repository. They now carry correction banners
pointing at this file; they were left in place rather than deleted since the
Android-facing parts of `WEBRTC_LIVE_SETUP.md` (above its banner) are accurate
and the test docs' structure is still a reasonable template for a real device
test once iPhone hosting actually exists.

## What changed

An iPhone/PWA chef can now watch an Android host's Live broadcast for real:
video, audio, live chat and heart/fire/clap reactions. This is **viewer-only**
-- going Live from an iPhone is not built. That scope matches the old
placeholder's own stated milestone ("the next Live milestone is Android ↔
iPhone signaling, camera, microphone and reconnection testing").

No new protocol was invented. The PWA speaks the *existing* signaling
contract Android's `WebRtcLiveTransport.kt` already implements
(`liveSessions/{id}/peers/{peerId}`, `hostCandidates`/`viewerCandidates`,
`offerSdp`/`answerSdp`/`state` fields) verified directly against that Kotlin
file and against `firestore.rules`. **`firestore.rules` needed zero changes**
-- `peerId` is already required to equal `request.auth.uid`, so a signed-in
PWA viewer was already a first-class participant in the existing rules; only
the Android app had ever actually exercised that path before now.

New files:
- `web/js/webrtc-signaling.js` -- pure helpers with no Firebase/WebRTC globals
  (ICE candidate doc-id generation and mapping, the Live discovery freshness
  check), mirroring `WebRtcLiveTransport.kt`'s constants exactly
  (`MAX_ICE_CANDIDATES_PER_SIDE = 64`, and `FirebaseSocialRepository`'s
  `LIVE_LEASE_TIMEOUT_MS = 35s` / `LIVE_LEGACY_GRACE_MS = 90s` /
  `LIVE_LEASE_REFRESH_MS = 5s`) so the two platforms cannot silently drift onto
  different freshness windows or candidate limits. Covered by
  `web/tests/webrtc-signaling.test.mjs` (9 tests) since this half needs no
  browser to test.
- `web/js/webrtc-live-viewer.js` -- `LiveViewerController`, the
  `RTCPeerConnection` + Firestore-listener orchestration mirroring
  `WebRtcViewerController` step for step: join by writing `peers/{myUid}`,
  apply the host's offer, answer, exchange ICE, tear down and delete
  the peer doc + its candidate subcollections on stop. Not unit-testable
  (needs `RTCPeerConnection`/a live Firestore connection) -- same as Android's
  own transport code, which also has zero unit tests and is verified on real
  devices instead.

`web/js/firebase-client.js` gained `observeLiveSessions` (world-readable,
same `allow read: if true` as Android; a periodic re-filter ages a session
out of the list if its host stops renewing `heartbeatAt`, since a dead host
produces no new Firestore event to react to), `observeLiveSession`,
`observeLiveComments`, `addLiveComment` and `sendLiveReaction`, each
byte-compatible with `FirebaseSocialRepository`'s equivalents. It now also
re-exports `db` and a handful of Firestore primitives so
`webrtc-live-viewer.js` can address documents/listeners directly without a
second pinned copy of the Firebase SDK.

`web/js/app.js`: real discovery list (search by chef/title/#tag, reusing the
existing shared `tag-utils.js` exactly like Android's own Live search) and a
room view (video, host chip, reaction buttons, live chat) replacing the
placeholder. The video element starts muted (autoplay policy on both iOS
Safari and Chrome) with an "Enable audio" tap-to-unmute button. The room is
painted directly into `#main` and patched in place by its own listeners
(status/reaction counts/ended banner), bypassing the normal tab `render()`
dispatch -- the same treatment `openCommunityRecipe()` already gives an open
comment thread, and for the same reason: a generic re-render would tear down
and recreate the `<video>` element (and its `srcObject`) on every unrelated
update. Back-button history support was extended to cover an open Live room
the same way it already covers an open chef profile/conversation.

One robustness improvement beyond what Android does today: before joining,
the viewer best-effort deletes any leftover peer doc from an earlier watch of
the same Live that did not end cleanly (closed tab, backgrounded Safari
evicted the page). Without it, rejoining would ask Firestore to "create" a
document that already exists -- rules see that as an update, and the update
rules only allow `OFFERED -> ANSWERED`, never a reset back to `JOINING` --
so a chef who left messily could never watch that Live again. A missing doc
makes the delete fail permission-denied, which is expected and ignored.

`web/sw.js` and `web/package.json` version bumped to 0.4.0 (the PWA's own
version track, separate from Android's `versionName`/`versionCode`).

## Verified

- `npm test` in `web/`: 95/95 passing (86 pre-existing + 9 new), including the
  shared golden cooking corpus unchanged.
- Live-browser check against the real `chefvoice-d7fec` Firebase project (no
  emulator): Live tab loads with zero console errors, the discovery query
  connects and correctly renders "Nobody is live yet" (no session was
  actually broadcasting), the sign-in note renders correctly signed out, and
  repeated tab navigation in and out of Live neither crashes nor leaks a
  listener.
- **Not verified**: an actual phone-to-browser video/audio call, since that
  needs a real Android device broadcasting Live at the same time as this
  session -- no device was available here. The signaling contract was
  cross-checked line-by-line against `WebRtcLiveTransport.kt` and
  `firestore.rules` instead of guessed at. A real two-device pass (Android
  host + iPhone PWA viewer, same Wi-Fi first) is the next thing to do with
  this build, using the same setup `LIVE_IPHONE_TEST.md` describes even
  though that specific doc predates real code.

## What did not change

`voice-capture.js`, `ingredient-parser.js`, `cooking-session-parser.js`,
`firestore.rules`, the Android app, `chefvoice-notifications`, and
`chefvoice-billing` are all untouched. Going Live *from* an iPhone (camera/mic
capture, permissions, publishing an offer as a host) is not built and is not
implied by anything in this doc -- see the correction banners on
`WEBRTC_LIVE_SETUP.md`, `LIVE_IPHONE_TEST.md` and `LIVE_TWO_WAY_TEST.md`. No
TURN relay was added; same-Wi-Fi is the only network path expected to work
reliably, matching Android's own documented limitation.
