# ChefVoice Android v0.8.4 — Activity Notifications

Status: generated/source-validated candidate. Firebase deploy, Windows Android build/install, and real-device notification acceptance are pending.

## Scope

ChefVoice now has one private activity-notification pipeline for:

- new private 1:1 Messages
- new comments on a chef's recipe
- new likes on a chef's recipe

For each supported event, the notification Functions create a private persistent Firestore activity record at:

`users/{uid}/notifications/{eventId}`

The Android app listens to those records and exposes a Notifications screen from Community and Profile. Unread activity gets a `NEW` badge and can be marked read individually or all at once.

The same event is sent to signed-in Android installations through Firebase Cloud Messaging. Android 13+ requests notification permission before the OS notification can be shown.

## Privacy and safety

- Notification documents are readable only by their owning Firebase account.
- Client code cannot create or delete notification documents; it may only advance `readAt`.
- Registered Android FIDs are private to their owning account.
- Push payloads are data-only and include the intended `recipientUid`.
- Android re-checks the current Firebase UID before displaying a push. A stale device registration therefore does not display another account's activity after sign-out/account switching.
- Message push text does not contain the private message body. It says only that a message arrived and tells the user to open ChefVoice.
- Comment pushes identify the commenter and recipe, but do not copy the comment text into the lock-screen payload.
- Like pushes identify the liker and recipe.
- Notifications are suppressed if either account has blocked the other.
- Deterministic like event IDs prevent unlike/re-like loops from generating repeated alerts for the same liker/recipe pair.
- Cloud Function retries are deduplicated by deterministic notification document IDs.
- Invalid/stale FIDs reported by FCM are removed from the account's device collection.

## Function isolation

Notification Functions live in the isolated Firebase Functions codebase:

`chefvoice-notifications`

This package deliberately does not include or redeploy the already-working `transcribeChefVoice` Second Pass function.

Functions:

- `notifyDirectMessage`
- `notifyRecipeComment`
- `notifyRecipeLike`
- `pushChefVoiceNotification`

## Deliberately unchanged

- deterministic cooking parser
- original private cooking audio architecture
- Second-Pass review/apply behavior
- accepted Method Review rerun/idempotency behavior
- Android rotation handling
- Live/WebRTC media files
- App Check enforcement policy (still OFF)
- Storage rules
- five-item Android primary bottom navigation

## Deploy/build sequence

From the extracted `ChefVoiceAndroid` directory:

1. `DEPLOY_COMMUNITY_PROFILE_RULES.cmd`
2. `DEPLOY_NOTIFICATIONS.cmd`
3. `BUILD_AND_INSTALL.cmd`

Run them one at a time and verify each succeeds before moving to the next.

## Real-device acceptance test

Use two accounts/devices where possible.

### Message
1. Sign in on Android account A and allow ChefVoice notification permission.
2. From account B, send A a private message while A is backgrounded.
3. Verify Android A receives a ChefVoice system notification without the private message body.
4. Open ChefVoice and verify the notification appears in the private Notifications screen and the normal Messages unread indicator also behaves correctly.

### Comment
1. Publish a recipe from account A.
2. From account B, comment on A's recipe.
3. Verify A receives an Android notification and a persistent in-app notification.
4. Opening the in-app activity item should open the recipe when it is available in the current feed.

### Like
1. From account B, like A's recipe.
2. Verify A receives one Android notification and one in-app notification.
3. Unlike and re-like that same recipe from B; it must not create repeated notification spam for the same liker/recipe pair.

### Account/privacy check
1. Sign out of A on the Android device and sign in as another account.
2. A notification addressed to A must not display under the other signed-in account.

Only after these paths succeed on the real device should v0.8.4 notifications be marked real-device accepted.

## iPhone/PWA note

The source supplied for this continuation is Android-only. The backend notification records are cross-platform-readable by design, but an iPhone/PWA system-push client is not claimed in this Android package. PWA/iPhone push requires the canonical PWA source and its web push/service-worker configuration to be updated and tested separately.
