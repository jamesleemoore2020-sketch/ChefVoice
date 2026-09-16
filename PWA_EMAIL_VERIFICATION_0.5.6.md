# PWA — Email verification flow (0.5.6)

Found live: James signed up a fresh PWA account to run the Chirp 3
round-trip test added in 0.5.5, and hit `transcribePrivateChefVoice`'s
"Verify your email before using ChefVoice Review" gate with no way to clear
it. The PWA had the *enforcement* (`firebase-client.js`'s
`emailVerified` check, also used for Community media uploads) but never got
the matching flow to actually send or recheck a verification email --
`signUp()` never called `sendEmailVerification`, and Profile had no button
for it either. Every PWA sign-up was permanently stuck unverified.

Ports Android's existing `sendVerificationEmail()`/`refreshEmailVerification()`
(`FirebaseSocialRepository.kt`) to `firebase-client.js`, and the matching
Profile UI (`ChefVoiceApp.kt`'s "Email verified"/"Email not verified" status
plus "Verify email" button) to `app.js`:

- Profile now shows email verification status and a "Verify email" button
  whenever signed in. Clicking it sends the real Firebase verification email
  and shows a status message; already-verified accounts see a disabled
  "✓ Email verified" button instead.
- `reload()` is required to see a server-side verified flip -- Auth's
  cached user object and `onAuthStateChanged` do not update on their own,
  same reason Android needed `refreshEmailVerification()`. The PWA has no
  `onResume` lifecycle, so a `visibilitychange` listener re-checks whenever
  the chef returns to a foregrounded Profile tab with the account still
  unverified, and re-renders if it just flipped to verified -- closest
  practical equivalent to Android's resume-triggered recheck.

No Firestore/Storage rules, Functions, Live, App Check, or billing changes --
this only calls existing Firebase Auth SDK functions the PWA already had
access to.

Cache/package version is 0.5.6.

## Validation

- PWA tests: 110/110. Cook wizard DOM: 60/60. Recipes list DOM: 33/33. All
  unaffected, re-run clean.
- Manual browser pass at `localhost:4173`: created a throwaway test account
  end to end, confirmed the "Email not verified" notice and "Verify email"
  button render, clicked it, and got a real "Verification email sent" success
  response back from Firebase Auth (not mocked).
- Not verified: the actual "click the link in the email, come back, see
  verified" round trip -- confirming that end requires a deliverable inbox,
  which the throwaway test address doesn't have. The send call succeeding
  against live Firebase Auth, and `refreshEmailVerification()`/`reload()`
  being the documented, already-proven-on-Android mechanism for picking up
  the flip, is the evidence available without one.
- Android untouched: this only ports the existing Android flow to the PWA
  side, `FirebaseSocialRepository.kt`/`ChefAppState.kt` are unchanged.

## Deploy

```
DEPLOY_PWA.cmd
```

Reload/reopen the PWA after deployment to pick up cache version 0.5.6.
