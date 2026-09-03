# ChefVoice v0.6 — Firebase + WebRTC signaling setup from Windows CMD

ChefVoice v0.6 keeps the Firebase member/community/live control plane and adds authenticated Firestore signaling for WebRTC live camera + microphone delivery.

Android application ID:

```text
com.chefvoice.app
```

## 1. Firebase Android configuration

In Firebase Console, register/open the Android app with package name exactly:

```text
com.chefvoice.app
```

Download `google-services.json` and place it at:

```text
ChefVoiceAndroid\app\google-services.json
```

## 2. Authentication

Firebase Console > Authentication > Sign-in method > enable **Email/Password**.

Members must sign in to publish recipes, like/comment/follow/bookmark, host a live, post live chat or send live reactions. Public recipe and active-live browsing can remain signed out.

## 3. Firestore

Create a Firestore database, then deploy the **updated v0.6 rules** from this project.

If Firebase CLI is installed:

```cmd
firebase login
firebase use --add
firebase deploy --only firestore
```

The v0.6 rules add permissions for:

```text
liveSessions/{sessionId}
liveSessions/{sessionId}/comments/{commentId}
```

## 4. Optional Cloud Storage

Storage is still used for published recipe photos, videos and original chef voice. The Live foundation does not upload a broadcast recording yet.

If Storage is enabled:

```cmd
firebase deploy --only firestore,storage
```

## 5. Cloud data used by v0.6

```text
users/{uid}
users/{uid}/likes/{recipeId}
users/{uid}/bookmarks/{recipeId}
users/{uid}/following/{chefUid}
users/{chefUid}/followers/{uid}

recipes/{recipeId}
recipes/{recipeId}/likes/{uid}
recipes/{recipeId}/comments/{commentId}

liveSessions/{sessionId}
liveSessions/{sessionId}/comments/{commentId}

Storage:
recipes/{uid}/{recipeId}/media/*
recipes/{uid}/{recipeId}/voice/*
```

A live session document contains the host ID/name, title, `LIVE`/`ENDED` status, timestamps, and reaction counters.

## 6. Build and install

```cmd
gradlew.bat clean assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

## 7. Test Live with two accounts

Phone A:

1. Sign in.
2. Open **Live**.
3. Enter a title and tap **Go Live**.
4. Allow camera/microphone permissions.

Phone B:

1. Open **Live** and join phone A's session.
2. Sign in to chat/react.
3. Send comments and reactions.

Back on phone A, tap **End** and confirm the session disappears from the active-live list.

## Media-transport boundary

Firestore is not used to carry video frames. In v0.6 it carries the live control plane plus WebRTC SDP/ICE signaling; camera and microphone media travel through WebRTC peer connections. See `WEBRTC_LIVE_SETUP.md` for the two-phone test and the STUN/TURN production limitation.
