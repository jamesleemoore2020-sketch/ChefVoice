# PWA Create/Cook flow — 0.5.1

The PWA Cook page now follows Android's progressive creation flow:

1. Capture — the existing top banner, Create recipe introduction and cooking capture.
2. Recipe Details — name, chef note, servings, tags and optional prep/cook minutes.
3. Ingredients/Method — editable ingredient and method lists, manual additions and expandable transcript recovery.
4. Media — original cooking-audio playback, Take photo, Record video and phone file selection with previews/removal.
5. Review — details, ingredients, numbered method and photo/video/voice counts before saving privately.

Each step has a progress header and Back/Next controls above the main tabs. Moving between steps retains edits, including unfinished manual entries. Returning to Cook from another tab keeps the current step. Successful saving starts the next recipe at Capture. Review requires a recipe name and at least one named ingredient. It blocks saving while microphone permission, recording or finishing is in progress; duplicate starts/saves are guarded. The Finish capture control stays available on later steps. Video capture is disabled while cooking voice capture is active.

Speech updates no longer rebuild ingredient or method editors as the user types. Existing parsing, original audio storage and publication behavior remain in place. Prep/cook minutes are included in local recipes and Firebase's existing permitted time fields. A failed recipe-list write retains the draft for retry. The Media step exposes existing whole-session audio; this patch does not add Android's separate voice-note recording system.

The PWA keeps its existing appearance, banner, tabs, Community and Live work. No Android source/version, security rules, Functions, Live or Community logic changes are included. Cache/package version is 0.5.1 and the new stylesheet is included in the offline cache.

## Base and application

Apply after `ChefVoice-PWA-GoLive-Handoff-0.5.0.patch`, on the same checkout that already contains the Community changes. Do not reapply earlier patches if they are already installed. The remote branch inspected during this task was still at `b55098a`; a local test baseline integrated the supplied PWA handoff. This incremental patch contains only the Create/Cook changes listed here, not a replacement of the older GitHub checkout. No GitHub push or production deployment was performed.

Download `ChefVoice-PWA-Create-Flow-0.5.1.patch` to Downloads. In Windows Command Prompt:

```bat
cd /d "C:\Users\james\ChefVoice\.claude\worktrees\chefvoice-2026-09-11-handoff-be3999"
git apply --check "C:\Users\james\Downloads\ChefVoice-PWA-Create-Flow-0.5.1.patch" && git apply "C:\Users\james\Downloads\ChefVoice-PWA-Create-Flow-0.5.1.patch"
```

If the check fails, stop and inspect/share the error rather than forcing the patch. After it applies:

```bat
npm --prefix web test
```

After passing tests, deploy only the PWA:

```bat
firebase deploy --only hosting:pwa --project chefvoice-d7fec
```

Reload/reopen the PWA after deployment. The top badge still reads the existing `PWA 0.2 · Firebase`; release/cache version is now 0.5.1, independent of that older static badge.

## Validation

- Existing PWA tests: 95 passed.
- Cook DOM integration: 43 checks passed against actual UI functions/parsers, with simulated audio/storage. Covers all five steps, escaped review content, draft retention, media, required fields, pending permission, active capture, original voice, transcript recovery, failed-save retry and cloud time conversion.
- JavaScript syntax, whitespace and patch application checked locally.
- No rendered visual, real camera/microphone or physical iPhone verification completed: browser installation timed out and the remote preview could not load the local page. No claim of actual device parity beyond the implemented structure.

Optional DOM checks require jsdom in the web project:

```bat
cd web
npm install --no-save --package-lock=false jsdom
node tests/cook-wizard.dom.mjs
```

On a phone, confirm the banner and each individual step, Back/Next placement above tabs, manual and spoken drafts, photo/video selection, audio playback, Review and saving. Check both Safari/PWA and Chrome at small widths, including the keyboard and safe area. Real microphone permissions and camera chooser behavior still depend on the browser/device.
