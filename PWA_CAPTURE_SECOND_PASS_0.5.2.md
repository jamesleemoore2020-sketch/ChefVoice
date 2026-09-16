# PWA — Second Pass on Capture (0.5.2)

The Cook wizard's Capture step can now run ChefVoice Review (Second Pass)
against the just-recorded audio immediately, before the recipe is saved,
instead of the chef only being able to run it after a recipe already exists.

- Finishing a capture reveals a "Run ChefVoice Review" card under the existing
  draft-ready status, once there is audio to review. It is opt-in, not
  automatic -- matching how the saved-recipe review already works.
- Accepting an ingredient or method suggestion writes straight into the
  wizard's in-progress Ingredients/Method lists, the same acceptance model
  already used for a saved recipe's review. Fields stay editable afterward.
  Recipe Details (name, servings, tags, prep/cook time) is unaffected --
  Second Pass has never classified durations, only ingredient and method
  text, so there is nothing there to prefill.
- The private audio upload needs a recipe id before any recipe document
  exists yet. It reuses the same not-yet-published-recipe allowance that
  `privateRecipeOwnedBy` (storage.rules) and `authorizeChefVoiceStorageUpload`
  (notifications/functions/index.js) already grant. Saving the recipe reuses
  that same id instead of minting a new one, so the already-uploaded private
  audio stays attached to the saved recipe rather than being orphaned under
  an id nothing ever references again.
- Counts against the same monthly ChefVoice Review quota
  (`secondPassRemaining`/`recordSecondPassUse`) as the saved-recipe review --
  it is the same paid Chirp 3 cloud call regardless of which screen triggers
  it, so running it during Capture raises the same Second Pass paywall once
  the month's free/Pro allowance is used up.
- A signed-out chef gets the same sign-in redirect as the saved-recipe
  review. The in-progress draft (transcript, ingredients, steps, audio) is
  untouched by the round trip to Profile and back, since wizard state lives
  independently of the current tab.

Cache/package version is 0.5.2. No Android, Firestore/Storage rules,
Functions, Live or Community changes are included.

## Validation

- PWA tests: 95/95.
- Cook wizard DOM integration: 60/60 (`node tests/cook-wizard.dom.mjs`),
  including new coverage added for this change: quota display, the
  signed-out redirect, a mocked cloud-transcription round trip, accepting an
  ingredient suggestion and a method suggestion into the draft, the quota
  decrementing on success and then blocking with the paywall once exhausted,
  and the eventual save reusing the pre-save draft id.
- Android `:app:testDebugUnitTest`: green (unrelated to this PWA-only change,
  confirmed as part of committing the rest of tonight's stack).
- Manual browser pass (`localhost:4173`): Capture renders correctly both with
  and without a recorded draft, zero console errors. The Browser pane blocks
  microphone access, so the actual cloud round trip against a real recording
  was not exercised live; the mocked DOM integration test above is the
  substitute, the same gap the prior Live/WebRTC verification hit for
  camera/microphone access it couldn't grant either.

## Deploy

```
DEPLOY_PWA.cmd
```

Reload/reopen the PWA after deployment to pick up cache version 0.5.2.
