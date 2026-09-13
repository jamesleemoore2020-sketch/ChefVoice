# ChefVoice — Firestore rules deploy gate hardening (v0.10.7 line)

## Problem

The 2026-09-11 `firestore.rules` deploy (adding the `tags` field) shipped
without running `rules-tests` first. `RUN_RULES_GATES.cmd` — the Firestore
emulator suite — is the only gate in this repo that actually evaluates a
security rule; every other gate (`RUN_NOTIFICATION_GATES.cmd`,
`RUN_BILLING_GATES.cmd`) only checks source text and path shapes. A rules
deploy also replaces the *entire* live ruleset in one shot, so a subtly
wrong rule doesn't get caught by anything else before it's live. Running
the emulator suite before a rules deploy was previously a documented best
practice, not something the deploy script itself enforced.

## Fix

`DEPLOY_COMMUNITY_PROFILE_RULES.cmd` (and `DEPLOY_COMMUNITY_RULES.cmd`,
which just calls it) now runs `RUN_RULES_GATES.cmd` first and refuses to
deploy if it fails or can't run, mirroring the pattern `DEPLOY_PWA.cmd`
already uses for `npm test`. The call is wrapped in `pushd`/`popd`, since
`RUN_RULES_GATES.cmd` `cd`s into `rules-tests/` and never restores the
caller's directory — without that, a passing gate would leave `firebase
deploy` running from the wrong folder.

Verified both paths for real without ever triggering a live deploy:

- **Refusal path**: temporarily added a deliberately failing test to
  `firestore-rules.test.js`, ran the deploy script, confirmed it printed
  "REFUSING TO DEPLOY" and exited 1 *before* reaching the `firebase deploy`
  line, then reverted the test file (`git diff` confirmed a clean revert).
- **Pass path**: ran `RUN_RULES_GATES.cmd` standalone against the real
  `firestore.rules` — 33/33 tests pass, exit 0.

Also hit and cleaned up the exact Windows emulator-JVM-survival issue
`CLAUDE.md` already documents (the Firestore emulator didn't fully exit
after `emulators:exec` and was left holding port 8080/9150) — confirms
that documented remedy still works.

## What did not change

`firestore.rules` itself, `rules-tests/firestore-rules.test.js` (net of the
temporary verification test, which was fully reverted), Cloud Functions,
Storage rules, and all Android/PWA app code are untouched.
`app/build.gradle.kts` stays at 0.10.7 / 59 — this is a deploy-tooling-only
change.

## Not done

Nothing was actually deployed to `firestore:rules` as part of this change —
`firestore.rules` hasn't changed, so there was nothing to ship.
