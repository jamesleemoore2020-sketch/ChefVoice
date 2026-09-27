# PWA audit fix bundle (PWA 0.5.18)

The first batch of fixes from the 2026-09-26 full audit (F3, F4, F5, F6, F7, F8, F9 and
part of F27), plus one bug the audit missed that the new browser smoke
tests found on their first run. Everything here is in `web/`; it ships as one pinned
`DEPLOY_PWA.cmd` (`hosting:pwa` only). **Live since 2026-09-26.**

**Not touched:** the parser and the golden corpus, Android, `firestore.rules`,
`storage.rules`, every Functions codebase, `transcribeChefVoice`, Live signaling, App Check.
No index deploy: the feed's new query uses the composite index Android's feed already runs on.

## The app no longer needs the Firebase CDN to start (found by the smoke tests)

`app.js` imported the two Live controllers statically, and both import `firebase-client.js`,
whose top-level `await` fetches the Firebase SDK from gstatic. That put the CDN inside
app.js's own module graph, so:

- **with gstatic unreachable — offline, a blocked network, a flaky kitchen connection — the
  whole app failed to start**, local cooking capture included, which is exactly what
  `firebase-client.js`'s own header says must never happen; and
- **every launch waited for the SDK (~700 KB) before drawing anything.**

The Live controllers are now loaded when a Live is opened (`loadLiveControllers`), by which
point `firebase-client.js` is already loaded for the signed-in chef. Nothing in app.js's
static graph reaches the SDK any more, and `web/tests/startup-graph.test.mjs` walks that graph
and fails if anything does again. The Live modules themselves are unchanged, so the rules
emulator tests that drive them are too.

## F3 — the service worker keeps only the app's own files

- **Nothing cross-origin is cached.** Firestore, Storage, the Firebase SDK and Analytics go
  straight to the network. The old worker cached every GET, so Firestore's Listen channel —
  direct messages, notifications — sat in Cache Storage after sign-out on a shared device. The
  new worker deletes every older cache when it activates, and sign-out additionally clears any
  cross-origin entry left in any cache.
- **The precache is complete**, and a test keeps it that way: `hosting-config.test.mjs` fails
  when a file in `web/js/` or `web/css/` is missing from `CORE`. Six modules were missing in
  0.5.17, two of them static imports of app.js.
- **A launch waits three seconds for the network**, then opens from the cache. A page opened
  from the cache gets its scripts from the cache too, so one launch never mixes modules from two
  deploys — an ES module that imports a name an older neighbour lacks fails to link.
- **Partial (206) and opaque responses are never stored**; the old worker rejected on every
  video range request.
- Launches — shared recipe links, push `?tab=` links — are stored under one key, not one cache
  entry per link.

Verified in headless Chromium (`e2e/service-worker.spec.mjs`): after a single online visit the
app reopens with no network and every tab works; with the Firebase SDK answering, not one
cross-origin URL lands in Cache Storage; the only cache is this version's.

## F4 — screen readers and zoom

- `<main>` is no longer an `aria-live` region. It is rebuilt on every render, so VoiceOver and
  TalkBack re-read the whole screen — every transcript line — during a capture. Status now goes
  to a dedicated, visually hidden `#srStatus` region: capture started or finished, draft ready,
  recipe saved, published or not, comment posted, Community errors, import results. Repeats are
  not re-announced. The Profile status lines are `role="status"` themselves.
- `user-scalable=no` is gone, so the screen can be pinch-zoomed (WCAG 1.4.4). Inputs are already
  16 px, so iOS will not zoom on focus.

## F6 — Like and Save do what they show

- `toggleLike`/`toggleBookmark` read the server and inverted it, so a button drawn from stale
  state did the opposite of what it said — a deep link to a saved recipe showed ☆ "Save" and
  tapping it **removed** the bookmark. They are now `setLike(id, liked)` and
  `setBookmark(id, saved)`: the caller asks for a state, and asking for the state that already
  holds writes nothing (the bookmark rule never allows an update anyway).
- An open Community recipe now follows the likes, bookmarks and feed listeners
  (`patchCommunityDetail`) instead of keeping the state it was drawn with. Its buttons carry
  `aria-pressed` and say what they do.
- The like count no longer guesses. It shows the backend count, plus the chef's own tap until
  the backend counter catches up; the old "count ± 1" double-counted a recipe whose count
  already included the chef.

## F7 — a half-written message survives incoming messages

Every incoming message and every read marker re-rendered the whole Inbox, taking the composer
with it. While a conversation is open the listeners now only update the badge; the thread
patches itself in place (`#messageThread`) and the composer — its text, focus and keyboard —
is left alone. Drafts are also kept per conversation outside the DOM, so a redraw that does
happen (blocking, unblocking) brings the draft back. Sending clears only what was sent.

## F8 — no more permanent unread badge

A conversation created by "Message chef" and never written in has no last message and no
sender. It read as unread to both chefs, and opening it cleared nothing because read time was
taken from the newest message and there was none. `conversationUnread` now has Android's guard
(last message and sender must be set), and opening a conversation marks it read at its own
`updatedAt` — the value Android writes — recorded locally first so the badge clears at once.

## F9 — the feed is newest first, with Load more

The feed asked for 100 public recipes with no order, which Firestore returns by document id —
random UUIDs — so past 100 recipes a newly published dish appeared only by luck. It now asks
exactly what Android asks: `isPublic == true`, `updatedAt` descending, 60 live, and **Load more**
reads the next page once (not live). A shared link to a recipe older than the first page is
read on its own instead of dropping the chef on the feed. (F28, moving the first page off a
live listener, is deliberately left for later: at today's size the listener costs nothing and
it is what keeps like counts current.)

## F5 — threads show their newest messages, not their oldest

Direct messages, recipe comments and Live chat listened with `orderBy('createdAt')` +
`limit(n)`, which is the **oldest** n: past 250 messages, 100 comments or 150 Live comments a
thread silently stopped showing anything new. All three use `limitToLast(n)` now. Android had
the same bug and the same fix lands in 0.11.18; `thread-windows.test.mjs` checks both.

## F16 — account, privacy and a way back in

- **Forgot password?** on the sign-in card. The PWA had no reset at all, and because the
  deletion page needs a sign-in, a web chef who forgot their password could not delete their
  account either. The reply is the same whether or not the address has an account.
- Profile has an **Account & privacy** card linking the privacy policy and the deletion page;
  the PWA linked neither, so a web-only chef had no route to deleting their account.
- Profile no longer shows engineering copy: the "Protected voice behavior" card ("ASR homophone
  repair" read as the automatic correction ChefVoice promises not to do), "Connected to
  ChefVoice Firebase", and Recipes' "Publishing now uses the verified ChefVoice Firebase
  project" are gone or in plain words (part of F27).

## Smaller fixes

- **The Inbox badge always showed**, reading "0" for anyone with nothing unread:
  `.bottom-nav button span.nav-badge{display:grid}` outranked `.nav-badge[hidden]`.
- **Community scrolled sideways at 375 px** when offline: the empty state printed the raw SDK
  error, an unbreakable gstatic URL. It now says, in a chef's words, that Community cannot be
  reached and their own recipes still work; long unbroken text (emails, links) wraps
  everywhere it could overflow — the Profile email the audit measured included.
- The header badge said "PWA 0.2 · Firebase" for three months of releases. It says the version,
  and a test keeps it equal to `package.json` and the service-worker cache key.
- "1 ingredients", "1 steps", "0 voice clip" → proper singular and plural everywhere.

## Tests

- PWA **258 / 0** (243 before): precache completeness, no cross-origin caching, version
  agreement, the startup import graph, set-not-toggle, the detail listeners, feed order and
  paging, the empty-conversation rule.
- jsdom checks **74 / 35 / 46** (the Inbox check grew by 11: the composer survives a new message
  and a redraw, drafts clear on send, read markers use `updatedAt` and skip empty conversations).
- New **browser smoke suite, `e2e/`: 9 / 0** in headless Chromium with every non-local request
  refused, so it can never touch production. It walks all six tabs, the five-step Cook wizard
  forward and back to a saved recipe, cook-along Next/Previous and its timer, zoom and the
  live region, the badge, sideways scrolling on every tab, and the three service-worker specs.
  Every spec fails on any console error.
