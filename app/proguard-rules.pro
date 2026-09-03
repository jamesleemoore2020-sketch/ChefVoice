# ChefVoice R8 configuration.
#
# Keep readable stack traces in Play Console. Upload
# app/build/outputs/mapping/release/mapping.txt with every release so crashes
# deobfuscate.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Model classes are converted to and from Firestore maps and local JSON by name.
# Nothing here is reflected over today, but obfuscating them buys nothing and a
# future toObject() call would fail silently, so keep them intact.
-keep class com.chefvoice.app.model.** { *; }

# WebRTC's Java layer is called from native code by name.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# OkHttp / Okio ship their own rules but still warn about optional platform APIs.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Firebase and Coil ship consumer rules in their AARs; nothing extra is needed.
