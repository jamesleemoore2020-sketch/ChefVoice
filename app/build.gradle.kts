plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Keep the project buildable before Firebase is connected. Once google-services.json
// is copied into app/, the Google Services plugin is applied automatically.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Release signing is driven entirely by these four environment variables. When any of
// them is unset Gradle skips signing, still reports BUILD SUCCESSFUL, and leaves an
// unsigned artifact that Play only rejects after upload. Readiness is computed once here
// so the buildType wiring below and the doFirst guard at the bottom of this file can
// never disagree.
val releaseSigningEnvVars = listOf(
    "CHEFVOICE_RELEASE_STORE_FILE",
    "CHEFVOICE_RELEASE_STORE_PASSWORD",
    "CHEFVOICE_RELEASE_KEY_ALIAS",
    "CHEFVOICE_RELEASE_KEY_PASSWORD"
)
val releaseSigningReady = releaseSigningEnvVars.all { !System.getenv(it).isNullOrBlank() }

android {
    namespace = "com.chefvoice.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.chefvoice.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 68
        versionName = "0.11.7"
    }

    buildFeatures {
        compose = true
    }

    lint {
        // False positive: releaseRuntimeClasspath resolves androidx.fragment to 1.5.4,
        // well above the 1.3.0 this check demands. Verified via
        // `gradlew :app:dependencies --configuration releaseRuntimeClasspath`.
        disable += "InvalidFragmentVersionForActivityResult"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        create("release") {
            val storePath = System.getenv("CHEFVOICE_RELEASE_STORE_FILE")?.trim().orEmpty()
            val storePass = System.getenv("CHEFVOICE_RELEASE_STORE_PASSWORD")?.trim().orEmpty()
            val alias = System.getenv("CHEFVOICE_RELEASE_KEY_ALIAS")?.trim().orEmpty()
            val keyPass = System.getenv("CHEFVOICE_RELEASE_KEY_PASSWORD")?.trim().orEmpty()
            if (storePath.isNotBlank() && storePass.isNotBlank() && alias.isNotBlank() && keyPass.isNotBlank()) {
                storeFile = file(storePath)
                storePassword = storePass
                keyAlias = alias
                keyPassword = keyPass
            }
        }
    }

    buildTypes {
        getByName("debug") { isDebuggable = true }
        getByName("release") {
            isDebuggable = false
            // R8 was off, so the release build shipped every Compose, Firebase and
            // WebRTC class unshrunk and unobfuscated. Upload
            // app/build/outputs/mapping/release/mapping.txt to Play so crash
            // reports stay readable, and smoke-test the release build on a device:
            // shrinking problems only ever show up at runtime.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (releaseSigningReady) signingConfig = signingConfigs.getByName("release")
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)

    // API-36 compatible AndroidX baseline. Activity 1.13.0 resolves Core 1.19.0,
    // whose AAR metadata requires compileSdk 37. Keep the stable Android 16 / API 36
    // build by using Activity 1.12.4 and pinning Core/Core-KTX to 1.17.0.
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.core:core:1.17.0") {
        version { strictly("1.17.0") }
    }
    implementation("androidx.core:core-ktx:1.17.0") {
        version { strictly("1.17.0") }
    }
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")

    val cameraXVersion = "1.6.1"
    implementation("androidx.camera:camera-core:$cameraXVersion")
    implementation("androidx.camera:camera-camera2:$cameraXVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraXVersion")
    implementation("androidx.camera:camera-video:$cameraXVersion")
    implementation("androidx.camera:camera-view:$cameraXVersion")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")

    val firebaseBom = platform("com.google.firebase:firebase-bom:34.17.0")
    implementation(firebaseBom)
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-storage")
    implementation("com.google.firebase:firebase-functions")
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.firebase:firebase-installations")

    // Product analytics. Instrumented before the paywall ships: retrofitting
    // events afterwards makes the first month of paywall data unusable, because
    // there is no pre-paywall baseline to compare a conversion rate against.
    // firebase-analytics also logs first_open automatically, which is the
    // install event -- ChefVoice does not emit a duplicate of its own.
    implementation("com.google.firebase:firebase-analytics")

    // ChefVoice Pro subscriptions and the lifetime unlock. Greenfield -- there was no
    // billing dependency before this, so no migration from an older Billing Library
    // major version was needed.
    implementation("com.android.billingclient:billing-ktx:9.1.0")

    // App Check is staged in monitoring mode. Debug builds use Firebase's debug
    // provider so sideloaded real-device validation remains possible; release builds
    // use Play Integrity. Backend enforcement stays OFF until metrics are proven.
    debugImplementation("com.google.firebase:firebase-appcheck-debug")
    releaseImplementation("com.google.firebase:firebase-appcheck-playintegrity")

    // WebRTC media transport for real phone-to-phone live video/audio.
    // libjingle_peerconnection_so.so was crashing with SIGTRAP (TRAP_BRKPT) inside its
    // own JNI_OnLoad on a real device (Samsung, arm64) every time a Live session was
    // joined, right after the phone took an Android 16 preview OS update
    // (pa3q:16/BP4A.251205.006) -- Live had worked on this same device before that
    // update. Confirmed via tombstone on both 144.7559.09 and 144.7559.14 (different
    // BuildIds, identical crash offset/signature), so a patch bump within the M144
    // milestone did not help; also ruled out a hardened-allocator opt-out
    // (android:allowNativeHeapPointerTagging="false"), the 16KB-page-size Developer
    // Options toggle (device doesn't have one), and 16KB ELF alignment (the .so's LOAD
    // segments were already 16KB-aligned). Moving past the whole M144 line to
    // 150.7871.01 (a materially newer milestone/toolchain from
    // https://github.com/webrtc-sdk/android/releases) fixed it: confirmed on-device via
    // logcat that the library now loads cleanly and a Live session reaches LIVE/
    // markLiveSessionReady with no crash. Root cause is presumed to be a bionic
    // linker/toolchain mismatch between the M144 build's NDK and this OS version.
    //
    // 150.7871.01 later regressed on this same device/OS: a different fatal signature
    // (SIGABRT / "JNI DETECTED ERROR IN APPLICATION: java_class == null" in
    // GetStaticMethodID, same JNI_OnLoad call site, BuildId 8939406b3b9fa259) started
    // occurring -- see LIVE_WEBRTC_NATIVE_CRASH_FINDINGS_0.11.2.md. 150.7871.01 is the
    // latest tagged release, so there is no newer version to bump to the way the first
    // fix did. Trying 144.7559.15 instead: a patch within the M144 line published later
    // than the 144.7559.09/.14 attempts above, in case it carries a compatibility fix
    // neither of those had.
    implementation("io.github.webrtc-sdk:android:144.7559.15")

    // Image loading. Replaces hand-rolled URL.openStream() + BitmapFactory decodes
    // that had no cache and no downsampling. coil-video renders local video frames.
    val coilVersion = "3.2.0"
    implementation("io.coil-kt.coil3:coil-compose:$coilVersion")
    implementation("io.coil-kt.coil3:coil-network-okhttp:$coilVersion")
    implementation("io.coil-kt.coil3:coil-video:$coilVersion")

    testImplementation("junit:junit:4.13.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
}

// Refuse to produce an unsigned release artifact. tools/BuildProductionTrust.ps1 already
// checks these variables before it calls Gradle, but a release task invoked directly from
// a shell that does not hold them would otherwise succeed silently and write an AAB/APK
// that cannot be uploaded.
val releaseArtifactTasks = setOf(
    "assembleRelease",
    "bundleRelease",
    "packageRelease",
    "packageReleaseBundle"
)
tasks.matching { it.name in releaseArtifactTasks }.configureEach {
    doFirst {
        if (!releaseSigningReady) {
            val missing = releaseSigningEnvVars.filter { System.getenv(it).isNullOrBlank() }
            throw GradleException(
                "Release signing is not configured, so this build would emit an UNSIGNED " +
                    "artifact. Unset or blank: " + missing.joinToString(", ") + ". Run the " +
                    "release build from the PowerShell session that holds the " +
                    "CHEFVOICE_RELEASE_* variables (see tools/BuildProductionTrust.ps1)."
            )
        }
    }
}
