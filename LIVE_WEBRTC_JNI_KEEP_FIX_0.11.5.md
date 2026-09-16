# Live JNI release fix candidate — Android 0.11.5 / versionCode 65

Date: 2026-09-12

Prepared against `b55098ae858668c0a22107c336d2774ad0dd0401` on
`claude/chefvoice-2026-09-11-handoff-be3999`.

Status: a missing release keep rule is reproduced and patched. The signed
Android build and on-device verification are still pending. Do not describe
this release as device-verified until the steps below pass.

## Evidence from build 64

James confirmed the installed package was version `0.11.4`, code `64`. The
uploaded crash buffer contains eight ChefVoice crashes between 16:28 and
16:36 on September 12 on the Samsung Galaxy S25 Ultra running Android 16.
Each has the same ARM64 native signature:

- `SIGTRAP`, `TRAP_BRKPT`, in `libjingle_peerconnection_so.so`, loaded from
  `split_config.arm64_v8a.apk`.
- Build ID: `0cc2410c540e806e`.
- Native PCs: `0x3a2e48`, `0x3a2a08`, `0x3a2744`, `0x395090`, and
  `0x299060` (`JNI_OnLoad+64`).
- Java frames lead through native-library loading and
  `PeerConnectionFactory.initialize`, before creating the Live transport.

The ARM64 library in the published
`io.github.webrtc-sdk:android:144.7559.15` AAR has exactly that build ID.
Disassembly of this matching binary traces the startup failure through
`InitGlobalJniVariables` / JNI Zero initialization to the class lookup for
the literal `org/jni_zero/JniInit` (at virtual address `0xbe5d0`). The fatal
path ends at the `brk #1` instruction at `0x3a2e48`.

This is distinct from the earlier M150 `SIGABRT` signature documented in
`LIVE_WEBRTC_NATIVE_CRASH_FINDINGS_0.11.2.md`. Redeploying Firebase Hosting
cannot replace native code or Java classes already packaged in the phone app.

## Cause and patch

The release build runs R8. Its rules kept `org.webrtc.**`, but JNI Zero lives
under the separate `org.jni_zero` package. Native code looks up these classes
and their methods by name; Java reachability alone does not preserve them.
The published WebRTC AAR contains the JNI Zero classes but no consumer keep
rules to protect them.

Added this rule in `app/proguard-rules.pro`:

```proguard
-keep class org.jni_zero.** { *; }
```

This preserves the small JNI bridge package, including `JniInit.init` and
`JniUtil`, with its original class and member names. R8, resource shrinking,
the existing WebRTC version, Live signaling, billing, and Firebase
configuration remain unchanged. The version is now `0.11.5` / `65`, and the
four existing source-gate version assertions were updated accordingly.

## Validation performed

An isolated shrinker experiment used the actual `classes.jar` extracted from
the published WebRTC AAR and R8 `9.3.16` (the version named by AGP 9.3.0's
`R8VersionCheckKt`). It compared the committed rules against the patched
rules, with the same inputs and optimization settings.

| Observation | Previous rules | Patched rules |
| --- | --- | --- |
| `org/jni_zero/JniInit.class` in optimized output | Absent | Present |
| JNI Zero classes retaining original package names | 0 | 17 |
| `JniInit` listed as removed in R8 usage output | Yes | No |
| `JniInit.init()` retaining its name in mapping | Absent | Yes |
| `JniUtil.arrayToMap` / `mapToArray` retaining names | Absent | Yes |

The experiment used R8's `--classfile --release --no-desugaring` mode with
Java 17 as its library. Missing Android types were suppressed only in the
temporary experiment configuration, not in the app rules. This validates
class retention; it is not a full app build or a device test. We have not
inspected the old signed AAB's DEX, so the matched crash path and reproduced
removal identify the targeted release defect without claiming final runtime
verification.

The commands in `RUN_NOTIFICATION_GATES.cmd` were run: 74/74 source gates
pass, and `node --check notifications/functions/index.js` passes. Those gates
check source contracts, not native execution or Firestore rule behavior.

## Build and verify on Windows

Use the existing checkout and signing environment in Command Prompt:

```bat
cd /d "C:\Users\james\ChefVoice\.claude\worktrees\chefvoice-2026-09-11-handoff-be3999"
BUILD_PRODUCTION_TRUST_APK.cmd
```

The build must report `0.11.5` / `65` and `BUILD SUCCESSFUL`. Before uploading,
confirm the optimized release preserved the native entry class:

```bat
findstr /C:"org.jni_zero.JniInit -> org.jni_zero.JniInit:" app\build\outputs\mapping\release\mapping.txt
```

That command must print the matching class line. If it prints nothing, do
not upload: inspect the applied rules and release output first.

1. Upload `ChefVoice-v0.11.5-Production.aab` to the existing internal testing
   track and publish that test release. Keep `ChefVoice-v0.11.5-mapping.txt`
   with the release; supply it in Play Console if the mapping was not already
   included through the bundle.
2. Update from Google Play on the same phone. Confirm the installed version:

   ```bat
   "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" shell dumpsys package com.chefvoice.app | findstr /I "versionCode versionName"
   ```

   It must show code `65`, name `0.11.5` before testing.
3. Open Live, start a broadcast, stop it, and start it again. Confirm the
   process stays running and the host camera preview appears.
4. Join from the deployed iPhone/PWA viewer. Check video, audio, chat, and
   reactions. This is a separate end-to-end check after native startup.
5. If the process still crashes, export the crash buffer immediately and
   compare the latest timestamp and build-65 frames. Old build-64 entries
   can still be present in the same buffer:

   ```bat
   "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" logcat -b crash -d -v threadtime > "%TEMP%\ChefVoice-live-crash-65.txt"
   notepad "%TEMP%\ChefVoice-live-crash-65.txt"
   ```

After the device test passes, record that result here. Keep production rollout
and the remaining Play Billing purchase checks as separate release steps.

## Upstream references

- [Published WebRTC 144.7559.15 AAR](https://repo.maven.apache.org/maven2/io/github/webrtc-sdk/android/144.7559.15/android-144.7559.15.aar)
- [WebRTC SDK release v144.7559.15](https://github.com/webrtc-sdk/android/releases/tag/v144.7559.15)
- [Matching WebRTC JNI VM initialization source](https://github.com/webrtc-sdk/webrtc/blob/30d5e63ae91da483e06577b5c35ee91cc5e5c3db/sdk/android/src/jni/jvm.cc)
- [R8 9.3.16 artifact](https://dl.google.com/dl/android/maven2/com/android/tools/r8/9.3.16/r8-9.3.16.jar)
