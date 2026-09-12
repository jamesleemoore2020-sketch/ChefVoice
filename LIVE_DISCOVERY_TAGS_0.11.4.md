# ChefVoice — Live discovery search and tags (0.11.4)

James reported that after starting a Live session, he switched to a second
account and couldn't find it. The underlying data layer was already global —
`FirebaseSocialRepository.listenLiveSessions()` queries `liveSessions` with
`whereEqualTo("status", "LIVE")` and no host/follow scoping, and
`firestore.rules` already had `allow read: if true` on the collection — and
the "Live" tab's `LiveHubScreen` already lists every live session, not just
followed chefs (sorted with follows first). What was actually missing: no way
to tag a session by category, and no search/filter on top of that list — so
a session was only findable by scrolling and recognizing it by title or host
name.

## What changed

- **`LiveSession`** (`Models.kt`) gained `val tags: List<String> = emptyList()`,
  following the exact same freeform-string convention as `Recipe.tags` (no
  fixed enum/taxonomy) so it reuses the existing `TagUtils` parsing
  (`parseTagsInput`, `tagMatchesQuery`) rather than inventing a second system.
- **`FirebaseSocialRepository`**: `startLiveSession()` takes an optional
  `tags` parameter; `toCloudMap()`/`toLiveSession()` read and write the new
  field.
- **`LiveHubScreen`** (`ChefVoiceApp.kt`): the "Start a Live" form gained a
  tags text field (same "comma separated, e.g. italian, baking" pattern as
  recipe tag entry). The "Live now" list gained a search field that filters
  the existing session list by chef name, title, or tag — mirroring
  `CommunityScreen`'s search exactly, including the same client-side
  filtering approach (no new Firestore query or index, same as how recipe
  tag search already works). Each live card now shows up to 3 tags as
  `#tag` text, matching the recipe card style.
- **`firestore.rules`**: `tags` added to `validLiveCreate()` (optional, list,
  max 8 entries — identical shape to the existing `recipes.tags` validator)
  and to `validLiveHostUpdate()`'s key allow-list, but deliberately left out
  of its mutable-field diff list, so tags are set once at Go Live and cannot
  be changed afterward (same immutability treatment as `hostId`/`hostName`/
  `startedAt`). No index changes needed — same reasoning as recipes: this is
  a client-side substring/tag filter over an already-open, already-unscoped
  query, not a new Firestore query shape.

## Verified

- `rules-tests/firestore-rules.test.js`: 4 new tests (a live session can be
  started with tags; rejects >8 tags; rejects non-list tags; a host cannot
  change tags after going live) plus all 33 pre-existing tests — 37/37
  passing against the Firestore emulator.
- `RUN_NOTIFICATION_GATES.cmd`: 74/74, version pins updated to 0.11.4/64.
- `gradlew.bat :app:testDebugUnitTest`: BUILD SUCCESSFUL, no new warnings.
- On-device visual/flow check still pending as of this writeup — see
  `BUILD_STATUS.md` for the live outcome.

## What did not change

WebRTC/live-session signaling (`WebRtcLiveTransport.kt`), the heartbeat/
lease freshness logic (`isFreshLive()`, `LIVE_LEASE_TIMEOUT_MS`), Play
Billing, and the PWA are untouched. The "Live now" list's global (not
follow-scoped) visibility is pre-existing behavior, not new in this change —
only the tags field and the search UI on top of it are new. Version
0.11.3/63 → 0.11.4/64.
