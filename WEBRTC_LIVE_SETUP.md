# ChefVoice v0.6 WebRTC live video setup

This build replaces the v0.5 host-only CameraX preview with real WebRTC camera + microphone delivery between signed-in ChefVoice members.

## What is sent where

- Firestore: room/session control, SDP offers/answers, ICE candidates, chat, reactions.
- WebRTC: camera and microphone media. Video/audio is not uploaded to Firestore.
- Architecture: small-room peer-to-peer mesh. The host creates one WebRTC PeerConnection per viewer.

## Required Firebase setup

1. Authentication -> Email/Password must be enabled.
2. Firestore must exist.
3. Replace the current Firestore rules with the `firestore.rules` file included in this project and Publish them.
   The v0.6 rules add `/liveSessions/{sessionId}/peers/...` signaling permissions.
4. `app/google-services.json` is already included in this package from the ChefVoice Firebase project supplied for this build.

## Build

This source package still expects a Gradle 9.5.x wrapper. If your extracted folder does not contain `gradlew.bat` and `gradle\\wrapper`, copy the same Gradle wrapper files you used to build v0.5.

Windows CMD:

    cd /d C:\Users\james\Downloads\ChefVoiceAndroid-v0.6.0-WebRTC\ChefVoiceAndroid
    gradlew.bat clean assembleDebug

APK:

    app\build\outputs\apk\debug\app-debug.apk

Install:

    "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk

## Two-phone test

Use two different ChefVoice/Firebase accounts. If both phones are signed in as the same account, both devices are considered the host because the live session host is identified by Firebase UID.

1. Phone A: sign in -> Live -> enter a title -> Go Live.
2. Phone A should show `LIVE video ready · waiting for viewers` and its local camera.
3. Phone B: sign in with a different account -> Live -> tap Phone A's live room.
4. Phone B should change from `Joining live video…` -> `Connecting live video…` -> `Watching LIVE video` and display/hear Phone A.
5. Phone A's viewer counter should increase.

## Debug log

    "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" logcat -c

Reproduce the issue, then:

    "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" logcat -d | findstr /I "ChefVoiceLive WebRTC Firebase Firestore PERMISSION_DENIED"

## Network limitation

This prototype uses public STUN servers and does not include a TURN relay credential. It can work on many home/mobile networks and is useful for proving real phone-to-phone media, but some NAT/firewall combinations will fail. If the UI reports that TURN may be required, the next production step is to add a TURN service or switch the transport to an SFU/managed provider such as LiveKit/Agora/Cloudflare Realtime.

For a public livestream with many viewers, do not keep the host-per-viewer mesh architecture: use an SFU/managed broadcast transport so the host uploads one media stream rather than one stream per viewer.


## PWA iPhone viewer

Starting with PWA v0.5, the iPhone/web client mirrors `WebRtcViewerController`.

The browser creates:

    liveSessions/{sessionId}/peers/{peerId}

Android host observes that peer, creates the offer, and writes `offerSdp`.
The browser sets the offer as its remote description, creates an answer, and writes
`answerSdp`. Host and viewer ICE candidates are exchanged through the existing
`hostCandidates` and `viewerCandidates` subcollections.

For the first real-device test use different ChefVoice accounts and the same Wi-Fi.
If Safari blocks unmuted autoplay, use the PWA's **Enable audio** button.

## PWA two-way Live extension (v0.6)

The browser client now implements both sides of the existing signaling contract.

### iPhone/PWA as host

1. PWA creates `liveSessions/{sessionId}` with the authenticated user as `hostId` and `status = LIVE`.
2. Android viewer creates `peers/{peerId}` with its `viewerUid`.
3. PWA host observes that peer, creates an `RTCPeerConnection`, adds iPhone camera/mic tracks, creates an SDP offer, and merges `offerSdp` into the peer document.
4. PWA host writes ICE under `hostCandidates`.
5. Existing Android `WebRtcViewerController` reads the offer, creates `answerSdp`, and writes ICE under `viewerCandidates`.
6. PWA host applies the Android answer and viewer ICE candidates.
7. Media is peer-to-peer; Firestore remains signaling only.

No Android signaling schema change is required for this direction.
