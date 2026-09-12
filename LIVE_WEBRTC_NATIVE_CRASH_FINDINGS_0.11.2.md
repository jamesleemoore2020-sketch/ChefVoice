# ChefVoice — Live/WebRTC native crash findings (as of 0.11.2)

Deprioritized for tonight per explicit decision: Part D Play Billing
purchase testing on build 62 is revenue-blocking and ready now; this is
not a regression from tonight's billing/paywall fix (`PLAY_BILLING_QUERY_FIX_0.11.2.md`)
— Live was already flagged in the prior handoff as "not started"/"pending
real-device testing," and this investigation is what that gap actually
looks like on a real device. Captured here so the follow-up session
doesn't have to re-derive it from scratch.

## Symptom

Tapping "Go Live" crashes the app outright, every time, on a Samsung
Galaxy S25 Ultra (`pa3q`, Android 16, build fingerprint
`samsung/pa3qsqw/pa3q:16/BP4A.251205.006/S938USQSCCZF9_OYNCCZF9:user/release-keys`).

## Root cause, confirmed via `adb logcat`/tombstone

Fatal native crash inside `libjingle_peerconnection_so.so`'s own
`JNI_OnLoad`, triggered from `org.webrtc.PeerConnectionFactory.initialize()`
→ `NativeLibrary.load()` → `System.loadLibrary("jingle_peerconnection_so")`:

```
F libc    : Fatal signal 6 (SIGABRT), code -1 (SI_QUEUE) ... pid: <n>, tid: <n>, name: m.chefvoice.app
F DEBUG   : Abort message: 'JNI DETECTED ERROR IN APPLICATION: java_class == null
F DEBUG   :     in call to GetStaticMethodID
F DEBUG   :     from java.lang.String java.lang.Runtime.nativeLoad(java.lang.String, java.lang.ClassLoader, java.lang.Class)'
F DEBUG   :       #11 pc 0000000000257218  .../libjingle_peerconnection_so.so (offset 0x3b4000) (JNI_OnLoad+64) (BuildId: 8939406b3b9fa259)
```

**Confirmed identically on two different builds**, ruling out a
debug-only CheckJNI false positive (the first hypothesis tested and
disproven):

- Debug build (sideloaded, `android:debuggable="true"`)
- The actual signed 0.11.2 production APK (`ChefVoice-v0.11.2-Production.apk`,
  release-signed, non-debuggable)

Both crash with the exact same abort message and the exact same native
library `BuildId` (`8939406b3b9fa259`), confirming this is a real crash
that will hit real users on this device/OS combination, not a
debug-tooling artifact.

## This contradicts a prior "fixed" writeup — noted, not yet resolved

`app/build.gradle.kts` (lines 146-162) documents a prior session's fix for
a *related* crash: `libjingle_peerconnection_so.so` crashing with
**`SIGTRAP` (`TRAP_BRKPT`)** in `JNI_OnLoad` on this exact device, right
after it took the same `pa3q:16/BP4A.251205.006` OS build. That was
diagnosed as a bionic linker/toolchain mismatch and fixed by moving from
the WebRTC SDK's M144 line to `150.7871.01` — "confirmed on-device via
logcat that the library now loads cleanly and a Live session reaches
LIVE/markLiveSessionReady with no crash."

Tonight's crash is on that same `150.7871.01` version, same device, same
OS build fingerprint, but a **different abort mechanism** (`SIGABRT` /
`JNI DETECTED ERROR`, not `SIGTRAP`). Two possibilities, unresolved:

1. The prior confirmation was real but something in the environment has
   since changed (a silent Play Services/System WebView/security-patch
   update under the same headline OS version could plausibly alter ART's
   JNI behavior without changing the top-level build fingerprint).
2. The prior confirmation didn't fully exercise this exact code path.

## External research (no fix found)

- `io.github.webrtc-sdk:android:150.7871.01` (currently pinned) is the
  **latest tagged release** as of this check — there is no newer version
  to bump to the way the previous fix did.
- `144.7559.15` (an older milestone line) has a **later publish date**
  than `150.7871.01` per the GitHub releases page — worth trying, since it
  may carry a compatibility patch the 150 line doesn't yet have.
- Found one related-but-different open upstream issue
  ([webrtc-sdk/android#40](https://github.com/webrtc-sdk/android/issues/40)):
  intermittent `SIGABRT` crashes in different JNI functions
  (`nativeLog`, `nativeStopRtcEventLog`, `nativeFreeTurnCustomizer`) during
  logging/teardown, not library load. Same broad family of native/JNI
  instability in this WebRTC fork, but not the same signature, and no fix
  offered in that thread either.

## Suggested next steps (not attempted tonight)

1. Try `io.github.webrtc-sdk:android:144.7559.15` and retest on this same
   device.
2. Test on a second Android device to isolate whether this is specific to
   this phone/OS build or affects the SDK generally.
3. If neither resolves it, file a fresh upstream issue against
   `webrtc-sdk/android` with this exact tombstone — the `JNI_OnLoad`/
   `GetStaticMethodID`/`java_class == null` signature doesn't match
   anything already reported there.

## What did not change

No code was modified for Live/WebRTC tonight. `WebRtcLiveTransport.kt`,
`LiveCameraPreview.kt`, `CameraCaptureScreen.kt`, and the
`io.github.webrtc-sdk:android` version pin are all untouched — this file
is findings only, pending the follow-up session referenced above.
