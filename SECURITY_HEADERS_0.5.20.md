# Security headers and a Content-Security-Policy (PWA 0.5.20)

Finding **F22** of the 2026-09-26 full audit: defense in depth for a UI built from template
strings. Committed on `claude/audit-implementation-2026-09-26-02973b`. **Live on all three sites
since 2026-09-28**, deployed from `8bfc237` and checked on the live sites; see "Deploying" at
the end.

**Not touched:** the parser and the golden corpus, `firestore.rules`, `storage.rules`, every
Functions codebase, `transcribeChefVoice`, Live signaling, App Check, Android. The deletion page
and the privacy policy are byte-for-byte unchanged; only the headers they are served with change.
No Play Console answer changes.

## Escaping

`escapeHtml` in `web/js/app.js` now escapes `'` as `&#39;` as well. The audit traced every
interpolation of chef-written text to `escapeHtml` and found no single-quoted attribute anywhere,
so nothing was exploitable; this removes the one condition under which an attribute would have
been. All 180 call sites write into HTML (element text, a double-quoted attribute, a
`<textarea>`), where `&#39;` reads back as `'`. None feeds `textContent`, a dialog or a title,
where it would show literally. Checked in the browser: a recipe named `Mom's "best" pasta &
<sauce>` shows as typed on Review and comes back intact into the field.

## Headers on every path of all three sites

Each Hosting target in `firebase.json` has a `"**"` header rule. Hosting matches header rules
against the path requested, not the rewrite's destination, so any narrower rule would miss the
deep links the `**` rewrite serves.

| Header | Value | |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | enforced |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | enforced; the browsers' default, now stated |
| `X-Frame-Options` | `DENY` | enforced |
| `Content-Security-Policy-Report-Only` | per site, below | reported, not enforced |

The audit said "both Hosting targets". There are three now: the privacy policy site joined in
session 9. All three get the headers.

**Framing is refused now, not after the trial.** A Report-Only `frame-ancestors` is not
enforced, so `X-Frame-Options: DENY` carries the clickjacking protection in the meantime. It
cannot break sign-in. On phones and in Safari the Firebase Auth SDK embeds
`/__/auth/iframe` from the auth domain (`chefvoice-d7fec.firebaseapp.com`, which the PWA's own
Hosting site serves) as the app starts, and Hosting does not add custom headers to its
reserved `/__/auth/` pages. Checked on dart.dev and flutter.dev, both Firebase Hosting sites
with a site-wide `X-Frame-Options: DENY`: their `/__/auth/iframe` and `/__/auth/handler` come
back without it, while their `/__/firebase/init.json` has it.

### The PWA's policy (`hosting:pwa`)

```
default-src 'self';
script-src 'self' https://www.gstatic.com/firebasejs/ https://apis.google.com/js/api.js
           https://apis.google.com/_/scs/ https://www.googletagmanager.com/gtag/js;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://firebasestorage.googleapis.com
        https://*.google-analytics.com https://*.googletagmanager.com;
media-src 'self' blob: https://firebasestorage.googleapis.com;
connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com
            https://securetoken.googleapis.com https://firebasestorage.googleapis.com
            https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com
            https://firebase.googleapis.com https://us-central1-chefvoice-d7fec.cloudfunctions.net
            https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com;
frame-src https://chefvoice-d7fec.firebaseapp.com;
worker-src 'self'; manifest-src 'self';
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

| Allowed | For |
|---|---|
| `www.gstatic.com/firebasejs/` | the Firebase SDK modules, and `importScripts` in `firebase-messaging-sw.js` |
| `apis.google.com` (two paths), `chefvoice-d7fec.firebaseapp.com` frame | the Auth SDK's sign-in iframe, loaded through Google's API loader |
| `firestore`, `identitytoolkit`, `securetoken` | Firestore; sign-in and token refresh |
| `firebasestorage` (connect, img, media) | uploads, and published photos, videos and voice clips shown by download URL |
| `us-central1-chefvoice-d7fec.cloudfunctions.net` | every callable: ChefVoice Review, import, upload permits, recipe deletion |
| `firebaseinstallations`, `fcmregistrations` | push registration |
| `firebase.googleapis.com`, `googletagmanager.com/gtag/js`, `google-analytics.com`, `analytics.google.com` | Analytics: its config fetch, gtag, and the measurement hits |
| `blob:` (img, media), `data:` (img) | recordings and picked photos previewed before saving |

- **No inline script and no `eval`.** The PWA has neither, so the policy allows neither.
- **Script hosts are pinned to paths.** gstatic and googletagmanager also serve code that runs
  anything: old AngularJS builds, and any stranger's Tag Manager container. Only `/firebasejs/`
  and `/gtag/js` are needed.
- **`style-src` keeps `'unsafe-inline'`.** The templates put `style="..."` on dozens of
  elements. Moving those into classes would let it go.

### The deletion page's policy (`hosting:delete-account`)

`default-src 'none'`; scripts from `/firebasejs/`, the Google API loader, and the page's own
inline script by its SHA-256; the inline `<style>`; Identity Toolkit, the token service and the
`deleteChefVoiceAccount` callable; the auth-domain iframe; and no forms, `<base>` or framing.
The script is allowed by hash rather than moved into a file, so the page Play links to stays
byte-identical. The hash is taken the way the browser takes it, after the HTML parser has turned
CRLF into LF, so a Windows checkout and CI agree.

### The privacy policy's policy (`hosting:legal`)

`default-src 'none'; style-src 'unsafe-inline'; img-src 'self'` (the favicon request), and no
forms, `<base>` or framing. The page loads nothing.

## How it was checked

- **Against the live backend.** In the Claude Browser pane, with `e2e/serve.mjs` sending these
  headers and the browser posing as an Android phone, so that the Auth SDK loads its sign-in
  iframe at startup the way it does on real phones: a signed-in start, all six tabs, and a
  Community recipe with a Storage photo. **No violations.** The app reached gstatic,
  `firebase.googleapis.com`, `apis.google.com`, googletagmanager, the auth-domain iframe,
  Identity Toolkit, Firestore's Listen channel, Google Analytics and Storage; all are allowed.
  Violations were read with a buffered `ReportingObserver`, which was first shown to catch a
  deliberate one. The deletion page (phone, signed out) and the privacy policy: no violations,
  and a deliberate inline script on the deletion page was reported, so the page's own script
  matches its hash. The Browser pane is signed in to a test account
  (`chefvoice-verify-test-916@example.com`), not James's own. Only navigation was done; nothing
  was written.
- **Not exercised live,** so allowed from what the SDK is known to call: the callables
  (ChefVoice Review, import, upload permits, recipe deletion), token refresh, uploads, push
  registration and Live. The Report-Only period is for these.
- **`web/tests/security-headers.test.mjs`** (9 tests), part of `npm test`, so it runs in CI and
  gates `DEPLOY_PWA.cmd`. It checks that:
  - every site sends the headers on `**`;
  - no policy allows inline or eval script, wildcards, bare schemes, plugins, `<base>` or being
    framed;
  - every script URL in `web/` is allowed;
  - every Firebase module the PWA imports has its hosts allowed (a new module fails until it is
    listed in the test and allowed in the policy);
  - the deletion page's scripts and inline-script hash match;
  - the privacy policy loads nothing;
  - `escapeHtml` escapes `'`.

  Each gate was checked by breaking what it guards, 14 ways; every break was caught.
- **e2e.** `serve.mjs` now sends the pwa target's headers from `firebase.json`, and a new auto
  fixture fails any spec whose page trips the policy. Chromium logs a Report-Only violation at
  *info* level, where the console-error check never looked. `security-headers.spec.mjs` checks
  the served headers (a deep link included) and that a violation is caught.
- **Deploy gates.** `DEPLOY_ACCOUNT_DELETION_PAGE.cmd` and `DEPLOY_LEGAL_PAGE.cmd` now run the
  header tests before deploying. A deletion page whose script was edited without updating the
  hash cannot ship, and the failure prints the new hash.

Tests: PWA 285 / 0 (276 + 9), jsdom 74 / 35 / 46, e2e 19 / 0 (17 + 2).

## Deploying

Three pinned deploys, one site each, in any order:

1. `DEPLOY_PWA.cmd`: PWA 0.5.20 and its headers.
2. `DEPLOY_ACCOUNT_DELETION_PAGE.cmd`: headers only.
3. `DEPLOY_LEGAL_PAGE.cmd`: headers only.

Then each site should answer with the four headers:

```
curl -sI https://chefvoice-d7fec.web.app/a/deep/link
curl -sI https://chefvoice-delete-account.web.app/
curl -sI https://chefvoice-d7fec-legal.web.app/privacy.html
```

and `https://chefvoice-d7fec.web.app/sw.js` should contain `chefvoice-pwa-v0.5.20`.

**Done 2026-09-28**, the three scripts in that order from `8bfc237`. Their gates passed (the PWA
tests 285 / 0, and the header tests 9 / 0 before each of the other two). Checked afterwards:

- **Headers.** Every path tried, deep links and `sw.js` included, answers with the exact policy
  in `firebase.json` and the three enforced headers.
- **Version.** `sw.js` reports `chefvoice-pwa-v0.5.20`, and the badge says PWA 0.5.20.
- **Sign-in pages.** Hosting's `/__/auth/iframe` and `/__/auth/handler` still carry none of the
  new headers, on both `web.app` and `firebaseapp.com`.
- **Deletion page.** The deployed page is identical to the repo's, and its script matches the
  hash in its policy.
- **In the browser.** The live sites, loaded in the Browser pane as a phone and at desktop size,
  raised no violations. That covered the PWA's Community feed (Storage photos, the sign-in
  iframe, a token refresh), the deletion page (Firebase SDK and sign-in iframe loaded; nobody
  signed in) and the privacy policy.

## Promoting the policy

There is no report endpoint yet, so a violation shows only in the console of the browser it
happened in, as an info-level message ending "The policy is report-only, so the violation has
been logged but no further action has been taken." Before enforcing, open the deployed PWA with
DevTools attached (Android: `chrome://inspect`; iPhone: Safari's Web Inspector) and run the
flows not exercised above: sign in, publish with a photo, ChefVoice Review, import a recipe,
turn on notifications, go Live. When nothing is reported, rename
`Content-Security-Policy-Report-Only` to `Content-Security-Policy` on each site. The tests accept
either, never both. A report collector would be its own small Functions codebase and deploy; it
is not part of this change.
