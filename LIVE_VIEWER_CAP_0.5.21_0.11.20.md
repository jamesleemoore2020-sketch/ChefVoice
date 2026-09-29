# A Live room holds six viewers (PWA 0.5.21, Android 0.11.20, `firestore.rules`)

Audit finding **F18**, the viewer cap. James's decision (2026-09-28): **cap viewers now; TURN
later**, once he has picked a provider. Committed on `claude/audit-implementation-2026-09-28-e6a4a5`.
**Not deployed yet**, and the rule has to go first (see the end).

## The problem

The host opens one WebRTC connection per viewer, and so one video encode and one upload per
viewer. Nothing limited how many, so a phone's uplink and battery gave out after a handful of
viewers, and every viewer's picture degraded together.

## What changed

- **Six viewers a room**, `LIVE_MAX_VIEWERS`, the same on both platforms (the audit suggested 5 to
  8). It stays the room size until an SFU carries the media.
- **The host turns the seventh away.** A new join (`JOINING`) that finds the host already sending
  to six gets `FULL` instead of an offer: no connection, so no encoder. It is written in a
  transaction, only over a join still waiting. Places are counted join by join, so two viewers
  arriving together cannot both take the last one. A viewer whose connection failed or closed no
  longer holds a place. The host is told: "Your Live is full: 6 viewers."
- **The viewer says so and leaves.** "This Live is full right now. Try again in a few minutes.",
  with **Try again**, which joins afresh. It leaves the room's signaling cleanly, so a later join
  can be offered once someone has left. Nothing retries by itself.
- **The Android host now answers only a waiting join**, as the PWA host already did. It used to
  make a connection for any peer document it did not have one for, whatever its state.
- **`firestore.rules`**: `validLivePeerHostFull` lets the room's host, while the broadcast is live,
  change a `JOINING` peer to `FULL`, changing only `state`, `hostUid` and `updatedAt`. Nobody else
  can, not over a viewer already offered, and a `FULL` viewer cannot answer.
- The PWA room's status line is now announced to screen readers (`role="status"`), so "full" is
  heard.

Firestore stays the signaling plane only; the media path, ICE and the lease are unchanged. App
Check, the parser and the corpus are untouched. **TURN is not in this change**: viewers behind
some mobile networks still cannot connect until it lands.

## Tests

- Rules emulator (87 / 0), with the real PWA host and viewer against the real rules in
  `rules-tests/pwa-live-host.test.js`: six viewers take the places; the seventh gets `FULL`, no
  connection is made for it, both sides say the room is full, and it leaves; once one of the six
  leaves, the next join is offered and answered. A viewer whose connection failed no longer holds a
  place. `firestore-rules.test.js` covers who may write `FULL`, and when.
- PWA (379 / 0): `tests/webrtc-signaling.test.mjs` holds Android to the same room size and message,
  and checks its host answers only a waiting join, turns it away when full, and does not count a
  failed connection, and that its viewer says so and offers Try again.
- Ten breaks, each caught: the host never turning anyone away, or counting a failed viewer; the
  viewer not noticing; the rule missing, allowing `FULL` over an offered viewer, or letting `FULL`
  change other fields; and on Android, a different room size, answering any peer document,
  counting failed viewers, or the viewer not noticing.
- Android's transport cannot run in these tests. The device check below covers it.

## To release

1. **The rule first**, with the batch's rules deploy (`DEPLOY_COMMUNITY_RULES.cmd`, after diffing
   the console's live rules). A new host against the old rules cannot write `FULL`, and the
   seventh viewer would sit on "Joining live video…".
2. Then PWA 0.5.21 and Android 0.11.20, in the order `BUILD_STATUS.md` gives.

## Check on devices before release

1. Android host, one viewer on another phone and one in a browser: both watch as before. This is
   the change to the Android transport that needs two devices.
2. The full room, if a debug build is convenient: with `LIVE_MAX_VIEWERS` set to 1 in that build
   only, a second viewer sees "This Live is full", Try again joins once the first has left, and
   the host sees "Your Live is full".
