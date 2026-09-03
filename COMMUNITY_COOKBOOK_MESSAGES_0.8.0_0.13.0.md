# ChefVoice Android 0.8.0 / PWA 0.13.0 — Community Cookbook + Private Messages

Status: generated candidate. Requires Windows Android build/install plus real-device Android/iPhone validation.

## Added
- Dedicated **Saved cookbook** inside Recipes. Existing Firestore bookmarks are now surfaced as a real cookbook instead of living only on Profile.
- Private **one-to-one Messages** on Android and PWA.
- Message entry points from Community and from another chef's public recipe.
- Shared Firestore conversation schema and rules on both platform packages.

## Conversation schema
`conversations/{conversationId}`
- `participantIds`: exactly two Firebase UIDs
- `participantNames`: display-name snapshot for the two participants
- `lastMessage`, `lastSenderId`, `createdAt`, `updatedAt`

`conversations/{conversationId}/messages/{messageId}`
- `senderId`, `senderName`, `text`, `createdAt`

Firestore reads are participant-only. Message creation requires `senderId == request.auth.uid` and caps text at 2,000 characters. Messages are private Firestore data, but this release does **not** claim end-to-end encryption.

## Deployment order
1. From `ChefVoiceAndroid`, run `DEPLOY_COMMUNITY_RULES.cmd` once. This deploys Firestore rules only.
2. Run `BUILD_AND_INSTALL.cmd` and verify Android v0.8.0.
3. Deploy PWA Hosting from the PWA `web` folder when ready. The PWA package also carries the same `firestore.rules` for portability.

## Real-device validation
Use two signed-in ChefVoice accounts.
1. Account A opens a public recipe from Account B.
2. Save it and verify it appears under Recipes → Saved cookbook on Android and PWA.
3. Tap Message chef, send a message, and verify Account B receives it in Messages.
4. Reply from B and verify the same conversation updates on A.
5. Verify a third account cannot read that conversation (Firestore rules gate).
6. Recheck Cook & Capture, Second Pass, Android rotation, and iPhone camera switching for regression.

## Protected architecture unchanged
- deterministic cooking parser unchanged on Android
- Second Pass reviewer unchanged on Android
- shared golden corpus unchanged and byte-identical
- iPhone Live/WebRTC hard media path unchanged
- raw cooking audio remains under the existing privateVoice boundary and is not attached to messages
- App Check remains staged/monitoring; this feature does not enable enforcement
