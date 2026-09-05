# ChefVoice Android — Live-video native crash fix (v0.10.4)

Applied on top of v0.10.3 (versionCode 54). One bug, found by joining a Live
session on a real device (Samsung, arm64) and hitting an instant native
crash every time.

Bump to versionCode 55 / versionName 0.10.4 is already in
`app/build.gradle.kts`.

---

## Joining a Live session crashed the app instantly, every time

Starting or joining a Live session reliably crashed the whole process the
moment the session reached `STARTING`, with:

```
F libc: Fatal signal 5 (SIGTRAP), code 1 (TRAP_BRKPT), fault addr ... in tid ...
```

The tombstone backtrace showed the crash inside `libjingle_peerconnection_so.so`
itself, at `JNI_OnLoad+64` — i.e. the WebRTC native library was crashing
while loading, before any of our code ran:

```
#00-#04 libjingle_peerconnection_so.so (JNI_OnLoad+64)
#05 libart.so (JavaVMExt::LoadNativeLibrary)
#06 libopenjdkjvm.so (JVM_NativeLoad)
...
#12 org.webrtc.NativeLibrary$DefaultLoader.load
#17 org.webrtc.NativeLibrary.initialize
#21 org.webrtc.PeerConnectionFactory.initialize
```

Live had worked on this same device before it took an Android 16 preview OS
update (`pa3q:16/BP4A.251205.006`), so this was a regression against the
device's new OS, not the app.

**Ruled out:**
- A patch bump within the same WebRTC milestone
  (`io.github.webrtc-sdk:android:144.7559.09` → `144.7559.14`) — the crash
  reproduced identically (different `.so` BuildId, same `JNI_OnLoad+64`
  offset), so whatever changed between those two patch builds wasn't it.
- A hardened-allocator opt-out (`android:allowNativeHeapPointerTagging="false"`).
- The 16KB-page-size Developer Options toggle — this device doesn't expose one.
- 16KB ELF segment alignment — the bundled `.so`'s LOAD segments were already
  16KB-aligned (`p_align = 0x4000`), confirmed by parsing the ELF program
  headers directly.
- A conflicting/duplicate native library from another dependency — the APK
  only bundles five native libraries for arm64-v8a, and every crashing stack
  frame stayed inside `libjingle_peerconnection_so.so` itself.

**Fix:** moved past the whole M144 line to a materially newer milestone,
`io.github.webrtc-sdk:android:150.7871.01` (from
https://github.com/webrtc-sdk/android/releases). No app-code changes were
needed — the `PeerConnectionFactory`/`WebRtcBootstrap` API surface used by
`WebRtcLiveTransport.kt` compiled unchanged. Confirmed fixed on-device: the
native library now loads cleanly (`nativeloader: ... libjingle_peerconnection_so.so
... ok`), and a Live session reaches `status=LIVE` with
`markLiveSessionReady callback: error=null`.

Root cause is presumed to be a bionic linker/toolchain mismatch between
whatever NDK built the M144 line and this device's new OS build — a
different WebRTC milestone means a different toolchain, which is
apparently what actually mattered (not the WebRTC version number itself).

---

## What did not change

Parser/voice pipeline, Firestore/Storage rules, App Check (still
monitoring-only), and the Live signaling/heartbeat-lease logic
(`WEBRTC_LIVE_SETUP.md`) are all untouched by this pass. This is a single
dependency-version change plus a version bump.

## Before you upload

1. `RUN_NOTIFICATION_GATES.cmd` — 70/70 (four tests hardcode
   versionCode/versionName and were updated).
2. `gradlew.bat :app:testDebugUnitTest` — passing, including the golden
   cooking corpus.
3. `tools\BuildProductionTrust.ps1`, then re-walk starting/joining a Live
   session on the same real device that was crashing.
