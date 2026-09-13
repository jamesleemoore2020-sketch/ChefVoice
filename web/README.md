# ChefVoice PWA — iPhone/Web candidate 0.3.0

This folder is a separate Progressive Web App client. It does not replace or modify the Android APK path.

## Protected feature: voice → ingredients

The Kotlin ingredient/session parsers were ported to browser JavaScript and covered by regression tests before UI work. The web candidate preserves:

- cooking measurement vocabulary and aliases
- ASR repairs such as `to teaspoons` → `2 teaspoons`
- partial-result measurement preservation
- alternative transcript preference for measurement-rich hypotheses
- spoken fractions and mixed fractions
- reconstruction across arbitrary recognition segment boundaries
- unmeasured ingredients after ingredient/action context
- rejection of obvious cooking time/temperature false positives

Web-only improvements in this candidate:

- `half a teaspoon each of salt and pepper` shares the measurement across both ingredients
- `actually make that three cups` updates the most recent matching measurement
- microphone audio is recorded independently of live browser speech recognition
- editable transcript recovery can rebuild the ingredient/method draft

## Run locally

Microphone access requires a secure context. `localhost` is treated as secure by browsers.

```bash
cd web
npm test
python3 -m http.server 4173
```

Open `http://localhost:4173` on the development machine.

For an iPhone, deploy this folder to an HTTPS host (Firebase Hosting, Cloudflare Pages, Netlify, a normal HTTPS web server, etc.). Then open the URL in Safari and use **Share → Add to Home Screen**.

## Tests

```bash
npm test
```

The parser tests use Node's built-in test runner and require no npm dependencies.

## Current integration gates

- Core local recipe capture: implemented
- Original audio recording: implemented with MediaRecorder
- Live browser speech recognition: implemented when `SpeechRecognition` / `webkitSpeechRecognition` is available
- Home Screen PWA/offline shell: implemented
- Firebase Web App registration: configured for project `chefvoice-d7fec`
- Email/Password sign-in and new account creation: enabled
- Chef profile read/edit sync: enabled
- Public Community Firestore feed: enabled
- Recipe publishing/unpublishing: enabled using the same Firestore schema as Android
- Recipe photo/video and full cooking-session voice upload: enabled through Firebase Storage
- Likes, bookmarks, follows and comments: enabled against the same Android collections/subcollections
- Android ↔ iPhone WebRTC Live: intentionally gated pending phone-to-phone signaling/media regression testing
- Server/cloud second-pass transcription: hook not enabled until a backend provider/credential strategy is selected; the original audio is retained so this can be added without changing the ingredient parser

Do not put private AI/service credentials in browser JavaScript. Any second-pass AI transcription or ingredient review should be called through a server endpoint.

## Current iOS WebKit speech guard

An August 2026 WebKit bug report describes `SpeechRecognition` hanging after audio/video playback on iOS 26.6. This candidate tracks media playback after the voice engine has been used. On iOS, ChefVoice preserves the current draft in `sessionStorage` and refreshes the web app before the next voice capture, avoiding a silent broken recognition session. Original cooking audio is stored in IndexedDB rather than the recipe JSON.

## Firebase Community writes enabled in 0.3.0

The registered ChefVoice PWA uses the same `chefvoice-d7fec` Firebase project as Android. Email/Password Authentication, deployed Firestore rules and deployed Storage rules were verified before the web write gate was opened. Firebase still loads dynamically so local cooking capture and ingredient parsing can start if the Firebase SDK/CDN is unavailable.

Publishing first creates an owner-readable Firestore recipe document, then uploads local photo/video and full-session cooking audio under `recipes/{uid}/{recipeId}/...`, then marks the recipe public with the uploaded URLs. This ordering keeps the current Storage rule lookup valid for brand-new recipes.

The voice/ingredient parser was not modified for this release and remains at 20/20 regression tests.
