# ChefVoice — Live/WebRTC native crash fixed (0.11.3)

Resolves the regression captured in `LIVE_WEBRTC_NATIVE_CRASH_FINDINGS_0.11.2.md`:
tapping "Go Live" was crashing every time on the Samsung Galaxy S25 Ultra test
device (`pa3q`, Android 16, `BP4A.251205.006`) with a fatal `SIGABRT` inside
`libjingle_peerconnection_so.so`'s own `JNI_OnLoad` (`JNI DETECTED ERROR IN
APPLICATION: java_class == null` in `GetStaticMethodID`).

## Fix

`app/build.gradle.kts`: `io.github.webrtc-sdk:android` moved from `150.7871.01`
(the version a *previous* session had confirmed fixed a different, earlier
crash on this same device — see the SIGTRAP history in the surrounding gradle
comment) down to `144.7559.15`, an M144-line patch published later than the
`144.7559.09`/`.14` patches that same previous session had already ruled out.

Before landing this, a parallel research-only session (no device access)
independently checked two things that firmed up the plan rather than changing
it: `144.7559.15` is a real, pullable tag (confirmed against the GitHub API,
not just the previous doc's claim), and no `150.x` release newer than
`150.7871.01` exists to fall back on instead. It also flagged the abort as
unlikely to be a CheckJNI artifact, since the same crash reproduced on the
signed, non-debuggable release APK. Checked directly on-device as a sanity
check: `adb shell getprop debug.checkjni` reads empty (off), confirming that.

## Verified on-device

Clean install of the `144.7559.15` build, `adb logcat` captured across a fresh
Go Live attempt:

```
I org.webrtc.Logging: NativeLibrary: Loading native library: jingle_peerconnection_so
D nativeloader: Load .../libjingle_peerconnection_so.so using class loader ns clns-9 ...: ok
D ChefVoiceLive: markLiveSessionReady callback: error=null
```

No `FATAL`, no `AndroidRuntime` crash, no abort — the library loads cleanly
and the session reaches `markLiveSessionReady` with `error=null`. Confirmed
interactively on the phone: Go Live now works.

## Still open, honestly

*Why* `150.7871.01` — previously confirmed working on this exact device/OS
build for the original SIGTRAP crash — later regressed into a different
`SIGABRT` failure mode is still unanswered. Both explanations raised in the
0.11.2 findings doc (a silent Play Services/WebView/security-patch update
altering ART's JNI behavior under the same OS fingerprint, vs. the original
confirmation not fully exercising this code path) remain unconfirmed. This
writeup fixes the symptom with a verified-working version pin, not a root
cause. If Live starts crashing again on a future OS update, re-open
`LIVE_WEBRTC_NATIVE_CRASH_FINDINGS_0.11.2.md`'s method (tombstone first, then
compare BuildIds) rather than assuming it's the same bug.

## What did not change

`WebRtcLiveTransport.kt`, `LiveCameraPreview.kt`, and `CameraCaptureScreen.kt`
are untouched — this is a dependency version pin only. Play Billing,
Firestore/Storage rules, notifications, and the PWA are all untouched.
Version 0.11.2/62 → 0.11.3/63; the four `notifications/*.test.js` files that
assert the current gradle version string were re-pinned to match.
