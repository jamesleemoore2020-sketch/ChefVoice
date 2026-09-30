# Private backup of recipes and original audio (PWA 0.5.21, Android 0.11.20)

Audit finding **F11**. Committed on `claude/audit-implementation-2026-09-28-e6a4a5`. **Not deployed
yet.** James's decisions (2026-09-28): backup is **part of Pro**, and **off until the chef turns it
on**. Restoring what the account already holds is for **every signed-in chef**.

## The problem

A chef's private library, including the original cooking recording the project treats as the
source of truth, lived on one device. Nothing uploaded a recipe that was not published, and
Android sets `allowBackup="false"` (which stays: the audio is private). A lost, reset or replaced
phone, or a cleared browser, lost everything the chef had not published. The Play listing says
"Recover cloud-saved recipes after signing in", which the apps did not do.

## What changed

- **Private backup, on Profile.** A switch, off to begin with. Turned on by a Pro chef, every recipe
  on the device that the account does not hold as it stands goes to the chef's own account a few
  seconds after it changes: the recipe as `isPublic: false`, its photos and videos in the recipe's
  Storage slots, and the original recording at `privateVoice/{uid}/{recipeId}/session`, the path
  ChefVoice Review already uses. One recipe at a time. The card says how many are waiting, and has
  **Back up now**. A chef without Pro who taps the switch sees what Pro includes; one whose Pro
  lapses keeps everything already in the account, and restore still works.
- **What it never does**: publish, unpublish, or send a published recipe's edits anywhere. Those stay
  the explicit Publish and Update Community they always were; a published recipe is already in the
  account, as published. Each backup write is a Firestore transaction that stops if the recipe has
  become public since the backup began (on another device, say), because a private copy written
  over it would quietly take it off Community. The write that finishes a backup also stops if the
  recipe was deleted while its photos uploaded, so a delete elsewhere is not undone.
- **What a backup holds**: the recipe's fields the cloud map already sends (title, description,
  servings, times, ingredients, steps, tags), the first 24 photos and videos, voice clips, and the
  original recording, which goes up **once** rather than with every edit (it can be 120 MB). Not
  held: the raw transcript and parse details, Second Pass results, collections and the shopping
  list. The recording is the source of truth, and Second Pass derives a transcript from it again.
- **Done in part, tried again.** A photo or recording that could not go up (a refused upload, or the
  day's upload allowance of 2 GB and 120 uploads used up) leaves the recipe waiting. Automatic
  passes try it again after 15 minutes, **Back up now** at once. A file the device no longer has
  cannot hold a backup open.
- **Restore.** At sign-in each app asks the account for the chef's recipes, published or backed up,
  and the Library (Recipes, on the web) offers the ones the device does not have, newest first:
  **Restore** or **Not now**. Not now lasts until the account has something newer. Profile offers
  it too, and can check again. Restore asks the account afresh first, so a recipe changed or deleted
  elsewhere comes back as it is now, or not at all. Each recipe comes back with its recording.
  - On **Android**, a recipe whose recording could not be downloaded stays offered, so nothing comes
    back without the audio the account holds for it.
  - On the **web**, the recipe and its photos come back, and a recording the browser could not
    download stays in the account, with **Download to this browser** on the recipe. A browser can
    only read Storage once the bucket allows the app's address (`storage-cors.json`, below).
- **ChefVoice Review keeps a recording the account holds.** Review uploads to that same path and then
  deleted the object, to save storage. It now leaves it when backup is on, or when the account
  already holds that recipe's recording (backed up or published), and otherwise cleans up exactly as
  before. Without this, a review would have deleted a backed-up recording.
- **Publishing** now records that the account holds the recording, and stops sending it again with
  every Update Community.
- **Deleting** a backed-up recipe deletes the account's copy too. The apps decide that from the saved
  recipe rather than the screen's copy, which may predate the backup. A recipe mid-upload is not
  deleted until its backup finishes; publishing it waits for the backup and then goes ahead.
- **A screen's old copy cannot undo a backup.** A screen that opened a recipe before its backup
  finished saves a copy from before it; Android's save keeps what the backup learned
  (`RecipeBackup.keepBookkeeping`), and the web assigns it into the recipe the screen holds.
- **Account deletion** already removed private recipes and everything under `privateVoice/{uid}/`.
  The deletion page and both apps now say it removes the private backup too.

Everything goes through rules that already allowed it: an owner's create and update of a recipe with
`isPublic: false`, an owner listing their recipes, and owner-only `privateVoice`. **No rules deploy,
no functions deploy.** The fields that record what the account holds (`backedUpAt`, and
`backedUpAudioId` on Android or `audioBackedUp` on the web) stay on the device: the cloud map is an
allow-list.

Parser, corpus, Live signaling and App Check are untouched.

## What it costs

- One Firestore list query per sign-in, reading as many documents as the chef has recipes in the
  account, for every signed-in chef.
- For a Pro chef with backup on, two transactional writes per backed-up version of a recipe, plus
  the uploads, which count against the existing per-chef Storage budget.

## Tests

- Android: `RecipeBackupTest` (what needs a backup, what restore offers, when a backup is complete,
  what a finished or partial backup changes, a stale copy keeping what the backup learned, restored
  recipes), `PrivateBackupTest` (the Profile card for Free, Pro, off and unverified chefs, restore
  on the card, the Library's offer, `saveRecipe` keeping the bookkeeping, `deleteRecipe` going by
  the saved copy), and two `RecipeRepositoryJsonTest` cases (the fields survive a restart; older
  recipes read as never backed up).
- PWA: `tests/backup.test.mjs` (the same decisions, and source gates on both clients: the
  transactions stop at a published or deleted recipe, nothing in a backup asks for a public recipe,
  backup is Pro-gated, a held recording is not re-sent), `tests/second-pass-cost.test.mjs` (the
  review still releases its upload, except when the account keeps it), and
  `tests/recipes-list.dom.mjs` (the Library offer, Not now, the offer while restoring, no delete
  mid-backup).
- Rules emulator: `rules-tests/private-backup.test.js` runs the PWA's own `writeBackupCopy`,
  `toCloudMap` and `listOwnRecipes`, lifted from `firebase-client.js`, against the real rules. A
  backup stages and finishes a new recipe privately and sends none of the device-only fields; it
  stops at a published recipe and leaves it published; its last write does not bring back a
  deleted one; it keeps the account's creation time and counters, which a plain write from the
  device's copy is refused for; a chef lists their private and published recipes and nobody else
  can, nor read or overwrite a backup; and the name sent must be the chef's profile name.
- One gate in `notifications/navigation-live-recipe-safety.test.js` found Android's
  `deleteRecipe` by its parameter's name, which changed; it now finds the function by name alone.
- Every rule above was broken on purpose and a test failed each time: PWA 18 breaks, Android 13,
  and 3 in the emulator (the transaction taking the device's creation time or like count, or
  writing over a published recipe).
- Not checkable here: real uploads, the download on a device, and the bucket's CORS. The device
  checks below cover them.

## To release

1. **Bucket CORS, once** (only the web's restore of recordings needs it; Android does not):

   ```
   gcloud storage buckets update gs://chefvoice-d7fec.firebasestorage.app --cors-file=storage-cors.json
   ```

   It lets the two PWA addresses read Storage responses in the browser; the Storage rules still
   decide who may read what. Until it is set, a web restore brings recipes and photos back and
   leaves recordings safe in the account.

   `gcloud` is not on the build PC, so run it in Cloud Shell (after `gcloud auth login` as the
   project owner). Cloud Shell has no copy of the repo, so this writes the same file first, then
   shows the setting:

   ```
   printf '[{"origin":["https://chefvoice-d7fec.web.app","https://chefvoice-d7fec.firebaseapp.com"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json && gcloud storage buckets update gs://chefvoice-d7fec.firebasestorage.app --cors-file=cors.json && gcloud storage buckets describe gs://chefvoice-d7fec.firebasestorage.app --format="default(cors_config)"
   ```
2. **`DEPLOY_ACCOUNT_DELETION_PAGE.cmd`** for the deletion page's wording.
3. PWA 0.5.21 and Android 0.11.20, in the order `BUILD_STATUS.md` already gives.
4. The Play listing's "Recover cloud-saved recipes after signing in" becomes true with 0.11.20.
   Private backup could be named as part of Pro there; that is James's call.

## Check on a device before release

1. Pro account, backup on: make a recipe with a photo and a recording. In the console, the recipe is
   `isPublic: false`, the photo is in `publicMedia/slot-00` and the recording at
   `privateVoice/{uid}/{id}/session`.
2. Edit the title: the recipe document updates, and the recording's Storage object does not change.
3. Sign in on another phone or a fresh install: the Library offers the recipe; Restore; the
   recording plays.
4. Run ChefVoice Review on the backed-up recipe: the recording is still in Storage afterwards.
5. Publish it, then Unpublish: public, then private, and backup never republishes it.
6. Delete it: gone from the console, and not offered again.
7. On the web, once the CORS step is done: the same restore brings the recording into the browser.
