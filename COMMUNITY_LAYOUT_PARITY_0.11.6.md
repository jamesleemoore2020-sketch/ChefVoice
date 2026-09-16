# Community layout parity — Android 0.11.6 / 66, PWA 0.4.2

James confirmed that Android Live works on 0.11.5 / 65 and that the iPhone
viewer works after the PWA 0.4.1 signaling fix. This update starts from those
two fixes and changes the Community presentation.

## Changes

- Android now displays the same Community banner artwork already used by the
  PWA. Both banners are 170 dp/CSS px tall, with the title at the lower left.
- Search, messages, and notifications sit inside the upper-right corner of
  each banner. Message and notification buttons retain separate unread counts.
  Their counts are capped visually at 99+, with the full count in the accessible
  label. Buttons use 48 dp/CSS px touch targets.
- PWA Community posts now use full-photo, 360 px cards with rounded corners.
  The chef chip and Follow/overflow controls sit at the top of the photo. The
  title, ingredient count, comment count, age, and first three tags sit in a
  translucent caption near the bottom. The full description remains in recipe
  detail.
- Like, comment, share, and save buttons form a vertical translucent rail
  inside the lower-right corner of each photo. The caption reserves space for
  this rail, and long chef names and titles truncate within the card.
- Existing double-tap liking, Following/Discover filtering, search, reporting,
  blocking, bookmarks, and recipe/comment actions remain wired to their existing
  handlers. Tapping the chef chip opens their profile; tapping the caption
  opens the recipe. A post without an image retains the same layout with a
  plate placeholder.
- The PWA envelope opens Inbox / Messages; the bell opens Inbox / Activity.
  Listener updates refresh banner badges without replacing the feed. Zero
  badges are hidden, including the existing bottom-navigation Inbox badge.
- Android's existing photo-card layout and appearance preference are retained.
  Fonts and emoji artwork continue to follow each platform's available fonts;
  the cursive font in James's Android screenshots is not bundled in the repo.

## Validation and limits

- PWA tests: 95/95 passed.
- Notification source gates: 74/74 passed; Functions JavaScript syntax passed.
- PWA app and service-worker JavaScript syntax passed; patch whitespace checked.
- 23 local DOM interaction checks passed against the production Community
  templates and event bindings with fixture data and simulated API/navigation
  endpoints. These cover likes and double-tap behavior, bookmarks, Following,
  caption/comments/share/profile routing, overflow menus, search, the two Inbox
  destinations, clearing badges, blocking, and signed-out controls. They do not
  exercise production Firebase or provide browser layout measurements.
- The cloud browser's URL policy blocked the local preview. No rendered phone
  screenshot or Safari visual verification is claimed.
- No Android SDK/signing environment was available here. The signed Android
  build and the final Android/iPhone appearance checks must run on James's
  machine/devices.

This change does not edit the protected cooking parser, Firestore/Storage
rules, Cloud Functions, billing, App Check, or WebRTC. The Android JNI keep
rule and PWA Live listener-order/cleanup fixes remain in place. No backend
rules or Functions deployment is required.

## Apply the incremental patch (Windows Command Prompt)

This patch expects the earlier Android 0.11.5 and PWA 0.4.1 patches to have
already been applied. Download `ChefVoice-Community-0.11.6.patch` to Downloads.

```bat
cd /d "C:\Users\james\ChefVoice\.claude\worktrees\chefvoice-2026-09-11-handoff-be3999"
git apply --check "%USERPROFILE%\Downloads\ChefVoice-Community-0.11.6.patch"
```

If the check reports an error, stop and share the output. If it prints no
error, apply it once:

```bat
git apply "%USERPROFILE%\Downloads\ChefVoice-Community-0.11.6.patch"
```

Build the Android release using the existing signing setup:

```bat
BUILD_PRODUCTION_TRUST_APK.cmd
```

Expected files in the repo root:

- `ChefVoice-v0.11.6-Production.aab` — Google Play upload (versionCode 66).
- `ChefVoice-v0.11.6-Production.apk` — signed APK for the existing test workflow.
- `ChefVoice-v0.11.6-mapping.txt` — retain with this release.

Deploy the iPhone/PWA update:

```bat
DEPLOY_PWA.cmd
```

That wrapper runs the PWA tests and deploys only Hosting target `pwa` to
`chefvoice-d7fec`. The service-worker cache identifier is now
`chefvoice-pwa-v0.4.2`. Close and reopen the iPhone PWA after deployment and
refresh if an already-open page still shows the old feed.

## Device check before the Play rollout

1. Install build 66 through the normal signed-release test workflow and open
   Community. Compare its banner with the updated iPhone PWA.
2. Check that the three banner icons open search, messages, and notifications;
   check unread badges before and after reading an item.
3. On iPhone, confirm that chef controls, captions, and all four post actions
   remain inside the photo. Check a long title, Following, search, opening
   comments, double-tap liking, and saving a post.
4. Start Live on Android and watch on iPhone once to confirm the already-working
   Live flow still behaves normally with the release artifacts.
5. James handles the Play Console upload and rollout for build 66.
