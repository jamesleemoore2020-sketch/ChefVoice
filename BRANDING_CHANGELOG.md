## v0.6.4 build compatibility

- Fixed AndroidX AAR metadata failure on API 36.
- Downgraded Activity Compose from 1.13.0 to 1.12.4.
- Pinned AndroidX Core/Core-KTX to 1.17.0 to prevent Gradle from selecting API-37-only Core 1.19.0.
- Branding and image placement are unchanged from the prior branded build.

# ChefVoice v0.6.1 branding changelog

- Added ChefVoice launcher icon and round icon.
- Added branded opening cover.
- Added ChefVoice orange/red Material 3 color scheme.
- Added compact brand mark to Recipes home header.
- Added Community hero artwork.
- Added Live hero artwork.
- Added recipe media thumbnails to Recipes cards.
- Added recipe media previews to Community cards.
- Optimized supplied artwork into app-friendly WebP resources.
- Bumped version to 0.6.1 (versionCode 9).

# ChefVoice v0.6.3 build repair

- Switched compileSdk/targetSdk from preview API 37 to stable API 36.
- Pinned lifecycle-runtime-compose to 2.10.0 for API 36 compatibility.
- Added support for the current `android sdk install` CLI with sdkmanager fallback.
- Improved Java runtime selection and USB authorization diagnostics.
- Bumped app version to 0.6.3 (versionCode 11).
