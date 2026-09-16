# PWA Go Live — candidate 0.5.0

Status on 2026-09-14: implemented and locally tested; deployment and real iPhone-to-Android media verification remain pending. See `HANDOFF_2026-09-14.md` for exact release and GitHub commands.

## User flow

Live now exposes Go Live. Setup accepts a title and tags, then an explicit Enable camera & microphone action opens a private, muted inline preview. The user can choose front/back camera before broadcasting. Go Live publishes the session; the live screen includes mute, comments, reactions, viewer count and End. Camera flipping during a broadcast is not implemented.

Preview does not create a public session. Back, navigation, sign-out, hiding the page and End stop capture. If permission resolves after cancellation, the returned tracks are stopped immediately. Hosting cannot start while the Cook recorder is using capture.

## Implementation

- `web/js/webrtc-live-host.js`: camera lifecycle, STARTING-to-LIVE publication, server-confirmed peer-listener readiness, heartbeat and end cleanup, and one RTCPeerConnection per viewer.
- `web/js/app.js`: setup/room templates and controls, authentication and navigation cleanup, comments/reactions, preview persistence through ordinary data refreshes.
- `web/js/firebase-client.js`: re-exports the existing Firebase SDK's `runTransaction` for guarded state publication and signaling writes.
- `web/css/styles.css`: host setup/preview styles.
- `web/package.json`, `web/sw.js`: 0.5.0 and precaching the host module.
- `rules-tests/pwa-live-host.test.js`, `rules-tests/package.json`: host lifecycle and authorization regression coverage.

The controller uses the existing Android/PWA SDP and ICE schema and unchanged Firestore rules. Joined-at and offer guards protect replacement joins against delayed signaling callbacks. ICE queues wait for their remote description; peer cleanup removes child candidates before the parent. Host heartbeats renew every 10 seconds; a watchdog stops capture after 25 seconds without acknowledgment. Existing discovery leases limit stale-room visibility if the final network write cannot complete.

## Validation

- Existing PWA tests: 95/95 passed.
- Full Firestore emulator run: 53/53 passed (37 existing, 5 viewer, 11 new host).
- Host UI: 16 offline DOM checks passed using simulated backend/controller endpoints.
- Syntax and git whitespace checks passed.

Host tests cover private preview, mute, camera replacement, permission denial/retry, late permission cancellation, actual host/viewer controller SDP/ICE exchange, outsider authorization denial, cancellation during publication, stale profile rejection, delayed offers during rejoin, real heartbeat writes plus watchdog expiry, same-account second-PWA viewer, active peer cleanup, and remote ending. Media devices and RTCPeerConnection are simulated; Firestore rules are real emulator rules. These are not actual camera/audio transmission tests.

## Release and device check

Run `DEPLOY_PWA.cmd` separately from any PowerShell command. It deploys only Firebase Hosting target `pwa`; no Android build, rules deployment or Functions deployment is required for this change.

On iPhone, explicitly permit capture and broadcast to an Android viewer signed into a different ChefVoice account. Confirm video, audio, mute, comments, reactions, End and quick rejoin. Recheck Android hosting to iPhone viewing. Confirm Community appearance and image-overlay actions on devices. Current Android host-mode selection uses account UID, so use separate accounts for cross-platform testing.

Transport remains the existing STUN-only peer-to-peer mesh. No TURN relay or SFU was added. Restricted networks may still prevent a media connection despite successful signaling. App switching/hiding deliberately ends the broadcast; background hosting is not supported by this implementation. Deployment and device checks are pending.

Browser implementation references: [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [WebKit inline video policies](https://webkit.org/blog/6784/new-video-policies-for-ios/).
