plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Keep the project buildable before Firebase is connected. Once google-services.json
// is copied into app/, the Google Services plugin is applied automatically.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.chefvoice.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.chefvoice.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 54
        versionName = "0.10.3"
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
            val signingReady = listOf(
                "CHEFVOICE_RELEASE_STORE_FILE",
                "CHEFVOICE_RELEASE_STORE_PASSWORD",
                "CHEFVOICE_RELEASE_KEY_ALIAS",
                "CHEFVOICE_RELEASE_KEY_PASSWORD"
            ).all { !System.getenv(it).isNullOrBlank() }
            if (signingReady) signingConfig = signingConfigs.getByName("release")
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

    // App Check is staged in monitoring mode. Debug builds use Firebase's debug
    // provider so sideloaded real-device validation remains possible; release builds
    // use Play Integrity. Backend enforcement stays OFF until metrics are proven.
    debugImplementation("com.google.firebase:firebase-appcheck-debug")
    releaseImplementation("com.google.firebase:firebase-appcheck-playintegrity")

    // WebRTC media transport for real phone-to-phone live video/audio.
    implementation("io.github.webrtc-sdk:android:144.7559.09")

    // Image loading. Replaces hand-rolled URL.openStream() + BitmapFactory decodes
    // that had no cache and no downsampling. coil-video renders local video frames.
    val coilVersion = "3.2.0"
    implementation("io.coil-kt.coil3:coil-compose:$coilVersion")
    implementation("io.coil-kt.coil3:coil-network-okhttp:$coilVersion")
    implementation("io.coil-kt.coil3:coil-video:$coilVersion")

    testImplementation("junit:junit:4.13.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
