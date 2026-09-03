# ChefVoice Android 0.8.3 — Private Message Blocking

Status: generated candidate; automated/source validation only; real-device acceptance pending.

## Scope
- Adds a private per-account block list at `users/{uid}/blocks/{blockedUid}`.
- Adds Block / Unblock controls inside an existing private conversation.
- Keeps existing message history visible after blocking.
- Hides the local message composer while the current account has the other chef blocked.
- Shows `BLOCKED` in the Messages inbox for conversations blocked by the current account.
- Firestore security rules prevent either participant from creating a new conversation or sending a new private message while either account has blocked the other.
- A blocked participant is not told which account created the block; denied sends use a generic unavailable-conversation message.
- Block lists are owner-private Firestore subcollections.

## v0.8.2 unread reliability hardening
- `messageReads/{conversationId}.lastReadAt` updates may only move forward.
- This prevents stale writes from another signed-in session from resurrecting already-read conversations.

## Deliberately unchanged
- Existing message history remains participant-readable.
- Public Community recipes and public Chef Profile content remain public; this build does not claim account invisibility.
- Cooking parser, original private cooking audio, Second Pass, Live media, and App Check enforcement policy are unchanged.
- Android keeps the five-item primary bottom navigation.

## Real-device validation
1. Deploy the included Firestore/Storage rules with `DEPLOY_COMMUNITY_PROFILE_RULES.cmd`.
2. Build/install with `BUILD_AND_INSTALL.cmd`.
3. Open a conversation between two test accounts.
4. On account A, tap `Block`, confirm, and verify the composer disappears and `Chef blocked` is shown.
5. On account B, attempt to send a new message. It must fail and no message should appear for either account.
6. Close/reopen Messages on account A and verify `BLOCKED` remains synced.
7. On account A, tap `Unblock` and verify both accounts can send again.
8. Confirm unread counts still clear normally and do not reappear after reopening the conversation on another signed-in session.
