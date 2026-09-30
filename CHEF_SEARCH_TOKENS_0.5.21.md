# Chef search that can find any chef (PWA 0.5.21, Android 0.11.20, `chefvoice-notifications`)

Audit finding **F10**. Committed on `claude/audit-implementation-2026-09-28-e6a4a5`. **Not deployed
yet**, and the order matters more than usual (see the end).

## The problem

Both apps searched for chefs by paging through `users` in document-id order, 50 at a time and 300
at most, matching the text on the device. Document ids are random, so a chef outside the first 300
could never be found, whatever was typed, and every search cost up to 300 reads.

## What changed

- **Every profile carries `searchTokens`**: every beginning, 2 to 20 characters, of every word of
  the chef's name, of the whole name run together, and of the words of their favourite things.
  "DaPlug" is found by "da", "plug", "daplug" or "Da Plug"; "ChefJ4Mr.Voice" by "chef", "j4", "mr"
  or "voice". Words split where a lower-case letter or digit meets a capital, accents and
  apostrophes are dropped, and the three readers of text (backend, PWA, Android) are held to one
  fixture, `shared/chef-search-words.tsv`.
- **Search is one `array-contains` query** for the longest word typed; the other words are checked
  on what comes back. Chefs whose name matches come before those found only by a favourite thing.
- **Only the backend writes tokens.** `syncChefSearchTokens` (a Firestore trigger in
  `chefvoice-notifications`) brings them up to date on every profile write, and writes nothing
  when they are already right, which is also what stops its own write looping.
  `backfillChefVoiceSearchTokens` (admin only, resumable, idempotent) gives them to profiles saved
  earlier. The rules keep clients from writing them, so no chef can stuff their profile with other
  chefs' names to turn up in their searches.
- **`firestore.rules`**: the profile shape accepts `searchTokens` (a list of at most 300); a create
  may not include it; an update's list of changeable fields does not include it. Without the shape
  change, every profile save by the apps would be refused once the backend had added tokens,
  because both apps save with a merge.

**What a chef notices:** anyone can be found. Search matches the start of a word, not the middle
of one ("lug" no longer finds DaPlug), and bios are no longer searched. The list still needs a
signed-in chef, as before.

## Tests

- Notification gates **119 / 0**: `notifications/functions/search-tokens.test.js` (the shared
  words, what a typed search finds, the cap keeping every name token, single letters) and
  `notifications/chef-search-tokens.test.js` (the trigger compares before it writes, the backfill
  is admin-only, the rule, both apps query and never write). Two older gates that pinned the
  300-profile walk now pin the single query.
- PWA **364 / 0**: `tests/chef-search.test.mjs` runs the shared words and searches against the
  backend's own token builder.
- Android: `ChefSearchTest` (the shared words, the key, matching, ranking).
- Rules emulator: three rules tests. The key one shows a profile the backend gave tokens can still be
  saved by its chef; it fails on the old rules. `rules-tests/search-backfill.test.js` runs the real
  trigger and backfill: a save gets tokens, a rename replaces them, an up-to-date profile is not
  written, only an admin can backfill, and 306 earlier profiles across a page boundary get their
  tokens.
- The rules suite now runs its test files one at a time: with five files sharing one emulator, an
  existing Live test got a garbled response under the load.

## To release

The rules and the backend go first, then the backfill, then the apps:

1. **`DEPLOY_COMMUNITY_RULES.cmd`**, after diffing the console's live rules. It must come before the
   trigger: once a profile has tokens, the old rules refuse every save of it.
2. **`DEPLOY_NOTIFICATIONS.cmd`** (the trigger and the backfill callable).
3. Once, `backfillChefVoiceSearchTokens`, called by an account with the `admin` claim until it answers
   `done: true` (how: "admin backfill" in `CLAUDE.md`; `functions:shell` cannot pass the claim).

4. Then PWA 0.5.21 (`DEPLOY_PWA.cmd`) and Android 0.11.20. Until step 3 has finished, the new search
   finds only chefs who have saved their profile since step 2.

Steps 1 to 3 are shared with F17 (`DELETION_WITHOUT_FULL_SCANS_0.5.21.md`): one rules deploy, one
notifications deploy, two backfills.

**Released 2026-09-29**, steps 1 to 4 in order (Android 0.11.20 still to come). The backfill finished
in one call: `{"done":true,"updated":8}`, so every profile has tokens. Checked under the live rules:
one `array-contains` query for "chef" finds all four chefs whose names start with it. In PWA 0.5.21,
searching "jey" finds ChefJeyJey.
