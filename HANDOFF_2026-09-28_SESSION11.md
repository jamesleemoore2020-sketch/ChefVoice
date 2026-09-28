# ChefVoice session handoff — 2026-09-28 (session 11: audit implementation, part 3)

## 1. TASK
Implement the 2026-09-26 full audit. The report is at
`C:\Users\james\Downloads\AUDIT_2026-09-26_FULL.md`, deliberately kept out of this public repo.
Part 3 is done: F22 and F23, both deployed and verified live.

## 2. TOUCHED
Branch `claude/audit-implementation-2026-09-26-02973b`, pushed, clean. It continues
`claude/audit-implementation-7bb2be` from `a3c30ff`.
- `firebase.json`: `"**"` headers on the pwa, delete-account and legal targets: a
  Content-Security-Policy-Report-Only, `X-Frame-Options: DENY`, nosniff, Referrer-Policy.
- `web/js/app.js`: `escapeHtml` also escapes `'`; Community voice clips use `preload="none"`.
  PWA is 0.5.20 (`index.html`, `sw.js`, `package.json`).
- New: `web/tests/security-headers.test.mjs`, `e2e/security-headers.spec.mjs`. Changed:
  `e2e/serve.mjs` sends firebase.json's pwa headers; `e2e/fixtures.mjs` has a `cspViolations`
  fixture.
- `DEPLOY_ACCOUNT_DELETION_PAGE.cmd` and `DEPLOY_LEGAL_PAGE.cmd` run the header tests before
  deploying.
- `firestore.rules` (F23); `rules-tests/firestore-rules.test.js` (+13 tests).
- New writeups `SECURITY_HEADERS_0.5.20.md` and `RULES_HARDENING_0.5.20.md`; top entry in
  `BUILD_STATUS.md`.

## 3. DECISIONS
- Headers go on all three Hosting sites; the audit named only two.
- `X-Frame-Options` is enforced now. Hosting never adds custom headers to `/__/auth/*`, so the
  sign-in iframe is unaffected.
- The deletion page's inline script is allowed by its SHA-256, so the page itself is unchanged.
- `replyToName` must equal the answered comment's `authorName`, not the chef's current profile
  name.
- The rules check photo and video URLs only. The list is padded to 24 slots so no slot needs a
  size check. Lists and pictures an update leaves unchanged are not re-checked.
- Test cleanup means unpublishing. Claude never permanently deletes.

## 4. RULED OUT
- Checking `voiceClips` URLs in the rules: Android's largest publish (24 photos, 16 clips, prep
  and cook times) then went over Firestore's 1,000-expression limit and was denied.
- A size check on each slot: hit the same limit at about 24 changed slots.
- Binding the document diff or the list to a `let`: no measurable saving. Writing the size and
  pattern inline: costs more.
- `profileNameMatches(replyToUid, …)`, the audit's suggestion: refuses replies to chefs who have
  renamed.
- A `report-uri` collector: needs a new Functions codebase; deferred.

## 5. VERIFIED — do not re-verify
- CI green on `638f4b1` (F22) and `8bfc237` (F23). Every later commit is docs only.
- Local suites: PWA 285 / 0, jsdom 74 / 35 / 46, e2e 19 / 0, rules emulator 66 / 0, notification
  gates 78 / 0. The new gates were checked by breaking what they guard: 14 ways for the header
  tests, 16 for the rules. Every break was caught.
- **Live since 2026-09-28:** PWA 0.5.20 and the headers on all three sites. Every path sends the
  exact policy in `firebase.json`, `/__/auth/*` sends none of it, and the live sites raised no
  CSP violations at phone or desktop size.
- The console's live rules matched `a3c30ff` before deploying. The F23 rules were released on
  2026-09-28.
- Real writes under the new rules all passed:
  - PWA, as DaPlug: photo publish, comment, reply, profile save, unpublish.
  - Android 0.11.18 on James's phone, as ChefJ4Mr.Voice: a bio edit on a profile that has a
    photo and a cover (bio put back to empty), a three-photo publish, Remove from Community.

## 6. GOTCHAS
- Chromium logs Report-Only violations at info level, not as errors. The e2e `cspViolations`
  fixture catches them.
- Browser pane accounts: `localhost:4173` is the test account
  `chefvoice-verify-test-916@example.com` (unverified email, so it can't publish media).
  `chefvoice-d7fec.web.app` is James's DaPlug. If a click fails with "not drawn yet", retry once.
- Run the deploy scripts from PowerShell by full path:
  `cmd /c "<repo>\DEPLOY_X.cmd" < NUL`.
- adb is at `C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe`.
  - In Git Bash, set `MSYS_NO_PATHCONV=1` first.
  - Images pushed with adb stay hidden (`is_pending=1`) until you run
    `content call --uri content://media --method scan_file --arg <path>`.
  - On the photo picker's grid, a slow swipe starts a drag-selection.
  - Android's "Choose from phone" takes one photo per pick.
- Next Android versionCode is 81; next PWA version is 0.5.21.

## 7. NEXT
1. James: release build of Android 0.11.19 / 80, the six-step device check at the end of
   `ACCESSIBILITY_AND_DARK_MODE_0.5.19_0.11.19.md`, then the Play upload.
2. Code: F21 (cook-along for real kitchens), then F30, F11, F29, F17, F10, F18, F31.

## 8. OPEN
- Test leftovers for James to delete:
  - the private recipes "Rules check test (unpublishing shortly)" (DaPlug) and
    "Rules check test Android - unpublishing shortly" (ChefJ4Mr.Voice);
  - the folder `Pictures/ChefVoiceRulesCheck` on his phone.
- The CSP is still Report-Only. Enforce it only after watching the flows listed in
  `SECURITY_HEADERS_0.5.20.md` in DevTools.
- Neither app has a button yet for recipe authors or Live hosts to delete comments.
- Play: 0.11.18 is on James's phone from Play; rollout percentage unknown.
- Carried over:
  - the F15 deploy is unverified;
  - AD_ID and Data safety answers;
  - keystore rotation;
  - F25;
  - uncommitted files in the main checkout;
  - the master merge plan;
  - the public "testing2" recipe;
  - TalkBack wording on a device;
  - tab naming across platforms (F19);
  - buttons whose label starts with an emoji (F12).
