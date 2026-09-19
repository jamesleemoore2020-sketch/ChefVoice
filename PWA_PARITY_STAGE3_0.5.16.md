# PWA parity, stage 3 — the two swipes (PWA 0.5.16)

Two gestures Android has had since 0.11.13, now on the PWA. They have opposite tempers, and
the difference is the whole point of the stage:

- **Swipe a Community card to the right to keep the dish.** It only ever *adds*. Dragging a
  recipe that is already saved must not quietly unsave it, because the gesture reads as "keep
  this", not "toggle this" — the same rule the double-tap like already follows.
- **Swipe a notification either way to clear it.** Both directions mean the same thing here,
  because the row is one alert and there is nothing to get wrong.

## The axis lock

The rule that matters most on a phone is not either threshold — it is that a finger which
starts moving *down* the feed must keep scrolling the feed. A gesture locks to an axis as soon
as it has travelled ten pixels, and never changes axis after: a drag that began as a scroll
stays a scroll for its whole life, even if it later curves sideways. Without that, a card
could steal a finger halfway down the page and leave the feed stuck.

The rows carry `touch-action: pan-y`, so the browser handles vertical scrolling itself and
only a sideways gesture reaches the app's code at all.

A sideways drag that ends over a button would otherwise also fire that button's click — and
open the recipe the chef was only trying to save. One click is swallowed after a real swipe,
and the guard is dropped again a moment later so it can never eat the next genuine tap.

## Notifications

The Activity tab now matches Android's row: the **type glyph** (✉ message, 💬 comment,
♥ like, 🔴 live, 👨‍🍳 follow, ↩ reply, 🔔 anything else), the title, body and arrival time, a
**✕** for chefs who would rather tap than swipe, and **Clear read notifications** for dealing
with everything already read in one go without touching anything still unread. "Dismiss" as a
word is gone; the ✕ and the swipe replace it.

A cleared row is faded and put out of the way at once rather than after a Firestore round
trip, because the gesture should feel like it did something. **A delete that fails puts the
row back** and says why in the backend's own words — a row that vanished but did not actually
clear is the worse outcome.

`Clear read notifications` deletes one document at a time rather than in a batch: the PWA's
Firestore client exposes a single-document delete, and a partial failure then leaves the rows
it could not clear visibly still there, which is honest.

## What did not change

- **The parser is untouched**, and no corpus row was edited.
- **No Firestore rules change, no Functions change, no new backend surface.** The swipe calls
  the `toggleBookmark` and `deleteNotification` the client already had.
- **Android is untouched** — `versionCode` stays at 77 / 0.11.16.
- Live/WebRTC and App Check are untouched; App Check stays monitoring-only.

## Files

- New `web/js/swipe-gestures.js` — every decision about direction, distance and the axis lock,
  as pure functions, so none of it needs a browser to test.
- `web/js/app.js` — a `bindSwipe` helper over pointer events, the two bindings, the rebuilt
  notification row, `Clear read notifications`, and `notificationGlyph`.
- `web/css/styles.css` — the swipe row, its backdrop and the clearing state.
- `web/sw.js` (cache `v0.5.16`, new module precached), `web/package.json`.

## Tests

PWA **243 tests / 0 failures** (227 before): `tests/swipe-gestures.test.mjs` adds 16, covering
the axis lock, a scroll that curves sideways, the clamped travel, both thresholds, and the
rule that an already-saved recipe is never unsaved.

New optional jsdom check `tests/inbox-activity.dom.mjs` (24 checks). The Activity tab **cannot
be exercised against a real account** — notification documents are backend-created
(`allow create: if false`), so a client can never make one to look at — which makes these the
only coverage that row markup, the ✕, the swipe, the failure path and clear-read get. Confirmed
to fail when the dismiss threshold is broken, rather than passing regardless.

All three jsdom checks green: 74 cook-wizard, 46 recipes-list, 24 inbox-activity.

## Verified in a browser

Against `web/` on `localhost:4173` in the Browser pane, signed in as the verification test
account:

- A vertical drag on a Community card moved it **not at all**.
- A 50px rightward drag moved the card 50px and faded the backdrop to 0.45 — `50/110`.
- A drag released short of the threshold settled back and saved nothing.
- A full swipe **saved the recipe for real**: the backdrop flipped to "★ Already saved" and
  the star to Unsave.
- Swiping the same card again left it saved. The recipe was then un-saved through the ☆ so
  the test account was left as it was found.
