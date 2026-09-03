# ChefVoice Android 0.8.1 / PWA 0.13.1 — Chef Profile + Messages Permission Closure

Generated candidate. Real-device confirmation required.

## Changes
- Fix new one-to-one conversation startup permissions while keeping participant-only reads.
- Android primary bottom navigation reduced from six to five destinations: Recipes, Create, Community, Live, Profile. Messages remains one tap away from Community and Profile.
- Expanded Chef Profile: avatar, cover photo, 500-character bio, up to 12 favorite things to cook.
- Community recipe detail surfaces the public chef profile summary.
- Public profile images use `profiles/{uid}/avatar/...` and `profiles/{uid}/cover/...`; owner-only writes, public reads.
- Existing parser, Second Pass, raw private audio boundary, App Check monitoring, and iPhone Live/media isolation remain protected.

## Required rules deployment
Run `DEPLOY_COMMUNITY_PROFILE_RULES.cmd` before testing messages or profile photo uploads. It deploys Firestore + Storage rules only.
