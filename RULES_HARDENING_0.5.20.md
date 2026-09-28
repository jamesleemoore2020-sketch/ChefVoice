# Firestore rules hardening (audit F23), alongside PWA 0.5.20

Finding **F23** of the 2026-09-26 full audit: six rules changes batched into one, because every
rules deploy replaces the whole live ruleset. Committed on
`claude/audit-implementation-2026-09-26-02973b`. **Live since 2026-09-28**, deployed with
`DEPLOY_COMMUNITY_RULES.cmd` after the console diff; see "Deploying" at the end. The rules
deploy is its own step, separate from any app version. The one client change it
comes with, voice clips that no longer preload, shipped in PWA 0.5.20 (live since 2026-09-28).

**Not touched:** the parser and the golden corpus, `storage.rules`, every Functions codebase,
Live signaling, App Check, Android. No app needs an update for these rules: each one was checked
against what both apps actually write.

## What changed

| Before | Now |
|---|---|
| Recipe photo and video URLs (`media[].url`) and profile `photoUrl` / `coverPhotoUrl` were free text | They must be download URLs from this project's bucket, or empty for a profile picture |
| A reply's `replyToName` was unbounded and unchecked | At most 120 characters, and equal to the answered comment's `authorName`. A comment that answers nobody cannot carry `replyToUid` or `replyToName` |
| A report's `targetId`, `targetUid` and `contextId` were unbounded | At most 180 characters each, which is where both apps already cut them |
| Live chat was accepted on an ended broadcast | Only while the session is LIVE and its host's lease is fresh (`activeLiveSession`) |
| Nobody but a comment's author could delete it | A recipe's author can also delete comments on that recipe, and a Live host can delete chat in their room |
| `importUsage` was closed only because no rule matched it | An explicit `allow read, write: if false` |

### Photo, video and profile-picture URLs

- **The accepted shape** is
  `https://firebasestorage.googleapis.com/v0/b/chefvoice-d7fec.firebasestorage.app/o/<object>`,
  with an optional query string. The object name is limited to the characters a download URL
  encodes it with; its slashes arrive as `%2F`. So a URL cannot climb out of the bucket with
  `../` or a backslash, carry a fragment, or name another bucket, another host or plain http.
  The tests try seven kinds of outside URL.
- **Old data stays editable.** A list or picture that an update leaves unchanged is not checked
  again. Both apps send the stored picture URLs back with every profile save, and a recipe with
  pre-check media can still be renamed or unpublished. A list that changes must be all Storage.
- **Every slot is checked.** Rules cannot loop, so each of the 24 slots is checked in turn
  (Storage's `slot-00` to `slot-23`; neither app publishes more). The list is padded to 24 with a
  URL that passes, which makes a per-slot size check unnecessary.

### Why voice clips are not checked

Firestore evaluates at most 1,000 expressions per request and denies the rest. Measured in the
emulator, against a filler function calibrated to that limit:

- An update of the largest possible recipe spends more than half the budget before any media
  check.
- Checking the 24 photo and video slots costs another quarter. The costliest real write, below,
  still has about a sixth of the budget spare.
- Checking the 16 voice-clip slots as well left under 3% spare, and less than none once the
  recipe also had prep and cook times.

The costliest real write is Android's publish, which fills every slot of a staged recipe in one
`set()`. With voice clips checked, that request was denied: a chef with many photos and clips
could not have published.

So voice clips are left to the apps:

- Android fetches a clip only when the chef taps play.
- The PWA's voice-clip players now use `preload="none"` (PWA 0.5.20).
- The PWA's Content-Security-Policy refuses audio from other hosts once it is enforced (F22).

A committed test publishes the largest recipe Android can, and fails if the budget is exceeded:

- 24 photos and videos, each with a step and a caption, and 16 voice clips;
- 300 ingredients and 300 steps, 8 tags, prep and cook times;
- a 180-character title and a 5,000-character description.

It passes now; add the voice-clip check and it fails.

### Why the reply name is checked against the answered comment, not the profile

The audit suggested `profileNameMatches(replyToUid, …)`. Both apps copy the answered comment's
`authorName`, and that name was checked against the chef's profile when the comment was written.
A chef who renames keeps the old name on their old comments, so a check against the profile would
refuse every reply to those comments. Checking the answered comment's recorded name gives the same
guarantee, that a reply cannot claim to answer someone it does not, without that failure. A test
renames Bob and then replies to his older comment.

### Clearing comments

The rules now allow recipe authors and Live hosts to delete comments. Neither app has a button
for it yet, so that is a UI follow-up; no further rules deploy will be needed for it. The comment
counter already resyncs after any delete (`syncRecipeCommentCountOnDelete`), whoever deletes.

## Tests

- **`rules-tests`: 66 / 0** (53 + 13 new). Emulator tests first: run against the old rules, 11 of
  the new tests failed, each at its gap. The other two already passed, and pin behaviour that must
  not change: a pre-check profile photo survives an edit, and the import counter stays closed.
- **Every change was then undone, one at a time (16 ways), and each undo was caught** by the test
  written for it. Two of the undos are the alternatives rejected above: checking the reply name
  against the profile, and checking voice clips too.
- **Unchanged elsewhere:** PWA 285 / 0, jsdom 74 / 35 / 46, e2e 19 / 0, notification gates 78 / 0.

## Deploying

1. **Diff against the live rules first.** A rules deploy replaces the entire ruleset, and no CLI
   command can read the deployed one. Open Firebase console → Firestore → Rules and compare the
   published rules with the version this change started from, `git show a3c30ff:firestore.rules`.
   It is identical to `d7311e8` (2026-09-11), the last commit to touch the rules. If the console
   shows anything else, stop: rules were deployed from somewhere that is not in this repo, and
   that difference has to be merged in first.
   **Done 2026-09-28:** James copied the published rules from the console, and they are
   identical to `a3c30ff:firestore.rules` (719 lines each, ignoring line endings). Deploying
   changes exactly this document's diff.
2. Run `DEPLOY_COMMUNITY_RULES.cmd`. It runs this emulator suite, then deploys `firestore:rules`
   only.
   **Done 2026-09-28** from `c4907f4` (its rules are those tested at `8bfc237`). The gate
   passed 66 / 0, the rules compiled in production, and the CLI reported "released rules
   firestore.rules to cloud.firestore". Afterwards, read-only: the live PWA's Community feed and
   a recipe (its photo and comment listeners) loaded without an error.
3. Then use the real apps against the new rules (**still to do**; nothing here was written from
   the Browser pane):
   - On the PWA: post a comment and a reply, and publish a recipe with a photo.
   - On Android: publish a recipe with photos.
   - Edit a profile that has a photo.
