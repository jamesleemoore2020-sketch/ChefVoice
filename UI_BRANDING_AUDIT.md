# ChefVoice v0.6.1 — UI, Branding and Image Placement Audit

## What was implemented

### 1. App identity / cover
- Selected the clean black-and-orange ChefVoice artwork as the primary brand cover because it has the strongest logo hierarchy and the least visual noise.
- Added it as an 800 ms branded opening cover inside Compose.
- Cropped the whisk-microphone mark from the same artwork for the Android launcher and round launcher icon.
- Added the same compact mark beside the ChefVoice title on the Recipes home screen instead of repeating the full poster.

### 2. Community
- Selected the bright social/community artwork for the Community tab because the visible reactions, comments and live counters explain the purpose of that section immediately.
- Cropped it into a horizontal hero so it works on a phone without consuming the entire screen.
- Kept the existing Community actions directly below the hero.

### 3. Live
- Selected the darker kitchen/live artwork with the REC/LIVE treatment for the Live tab because it visually communicates broadcast cooking more clearly than the other dark alternative.
- Cropped it into a horizontal hero and placed it above the live controls/session list.
- The other dark kitchen artwork was intentionally not used; it is visually similar and would make the app feel repetitive.

### 4. Recipe media visibility
- Recipe photos/videos were already captured and stored, but they were not surfaced in the Recipes list or Community feed.
- The first recipe media item is now used as a thumbnail/banner on recipe cards.
- Community recipe cards also show the first recipe media item when available.
- Video items fall back to a clear video placeholder when a thumbnail is unavailable.

### 5. Visual system
- Added a warm ChefVoice Material 3 color scheme based on the orange/red artwork, replacing the generic default Material styling.
- Retained a light application surface for readability and to keep the cooking/editor screens practical.
- Added image content descriptions for the new branded assets.
- Constrained the Recipes and Community lists with weight so the new headers do not crowd or push list content off-screen.

## Audit findings still recommended for a later pass

### High priority
1. **Build reproducibility:** the v0.6 source package has no Gradle wrapper. A clean checkout cannot be built with the documented one-command workflow until the wrapper is restored.
2. **Live reliability/scaling:** the current WebRTC design is peer-to-peer/STUN-oriented. For a production public live product, TURN and/or an SFU architecture is still needed for NAT reliability and multi-viewer scaling.
3. **Remote image memory:** remote recipe images are decoded through a raw URL stream with no caching/downsampling. Replace this with a production image pipeline before feeds become media-heavy.
4. **Create Recipe complexity:** CreateRecipeScreen is a very long single flow. The feature set is strong, but the screen would be easier to use if split into progressive sections such as Capture → Recipe Details → Ingredients/Method → Media → Review.
5. **Permission onboarding:** camera/microphone permissions are requested functionally, but the app should show a short in-context explanation before the Android permission prompt.

### Medium priority
6. Replace emoji navigation glyphs with a consistent vector icon set.
7. Add host/avatar and optional live preview thumbnails to live-session cards when the data model supports them.
8. Persist the selected bottom-navigation tab across activity recreation.
9. In the Method editor, identical step text can make `indexOf(step)` and remove-by-value behavior ambiguous; use stable step IDs.
10. The profile model contains `photoUrl`, but the UI does not currently let the user set or display a profile image.
11. Review `android:allowBackup="true"` against the intended privacy model because local recipe/audio/media content may be user-sensitive.

## Selected source artwork
- `ChatGPT Image Aug 11, 2026, 09_13_40 AM (3).png` → app cover + launcher mark.
- `ChatGPT Image Aug 11, 2026, 09_13_40 AM (2).png` → Community hero.
- `ChatGPT Image Aug 11, 2026, 09_09_36 AM(1).png` → Live hero.
- `ChatGPT Image Aug 11, 2026, 09_13_39 AM (1).png` → intentionally not used because it overlaps the Live visual role.

## Build note
The source is updated to versionName `0.6.1` / versionCode `9`. This environment does not include the Android SDK/Gradle Android toolchain or the project Gradle wrapper, so the modified APK could not be compiled here. Build the updated source in the same Android/Windows environment used for the previous ChefVoice APK, after restoring the Gradle wrapper if necessary.
