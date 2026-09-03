# ChefVoice Android 0.8.2 / PWA 0.13.2 — Synced Unread Messages + Inbox States

Status: generated candidate; real-device acceptance pending.

## Changes
- Added private per-account read markers at `users/{uid}/messageReads/{conversationId}`.
- Read state syncs across a user's Android/PWA sessions without exposing read receipts to the other participant.
- Added unread conversation counts and per-conversation NEW indicators.
- Android keeps the five-item primary navigation; unread counts appear on Messages entry points and inbox.
- PWA shows a compact unread badge on its existing Messages bottom-nav item.
- Added explicit inbox/conversation loading, empty, and error states.
- Message access remains participant-private; no E2E-encryption claim.
- Firestore rules are narrowed to owner-only messageReads documents and validate conversation participation.

## Protected baseline
Cooking parser, Second Pass, private raw audio, Live media isolation, and App Check enforcement policy are intentionally unchanged.
