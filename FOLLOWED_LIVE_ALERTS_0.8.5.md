# ChefVoice Android v0.8.5 — Followed Live Alerts

This release extends the proven v0.8.4 Activity Notifications pipeline with notifications when a chef the signed-in user follows starts a new Live session.

## What changed

- Added backend `notifyFollowedChefLive` on `liveSessions/{sessionId}` creation.
- Reads `users/{hostUid}/followers` and creates one private `live` notification per follower.
- Suppresses notifications when either account has blocked the other.
- Uses deterministic `live_<sessionId>` notification IDs per recipient to deduplicate retries.
- Fans out in bounded groups of 100 instead of an unlimited `Promise.all`.
- Adds a dedicated `liveSessionId` notification field; recipe/conversation IDs are not overloaded.
- Existing `pushChefVoiceNotification` carries `liveSessionId` through the same proven FCM delivery pipeline.
- Android in-app Notifications renders Live alerts and opens the matching active Live room when available.
- Android system-notification taps carry Live session metadata into the app, switch to Live, and open the matching active session once the Live feed is ready.
- If the session has already ended, the system tap still opens the Live area and the in-app notification reports that the session is no longer available.
- `DEPLOY_NOTIFICATIONS.cmd` now installs notification Function dependencies when needed and sets `FUNCTIONS_DISCOVERY_TIMEOUT=30`, preserving the working isolated codebase and IAM setup.

## Protected architecture

No changes were made to the deterministic cooking parser, Second Pass reviewer, raw cooking audio handling, Live WebRTC/media transport, Storage rules, shared golden corpus, or App Check enforcement policy. The packaged Firestore rules are aligned to the already-deployed cross-platform notification-device rule (`platform` is limited to `android` or `web`) so using the Android rules helper cannot regress PWA registrations.

## Required acceptance

Real-device acceptance remains required after deployment/build:

1. Account A follows account B.
2. Background ChefVoice on A.
3. B starts a new Live session.
4. A receives a system notification and persistent in-app Live notification.
5. Tap the alert; ChefVoice opens Live and joins/focuses the matching active session.
6. A non-follower receives no alert.
7. A unfollows B; B starts a different new Live session; A receives no new Live alert.
8. Repeat the follower path on iPhone/PWA v0.13.4 after deploying its matching backend/Hosting candidate.

Do not change working Firebase/Cloud IAM unless logs show an actual regression.
