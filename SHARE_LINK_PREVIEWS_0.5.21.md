# Shared recipe links that preview as the dish (PWA 0.5.21, Android 0.11.20, `chefvoice-share`)

Audit finding **F29**. A recipe shared from ChefVoice went out as
`https://chefvoice-d7fec.web.app/?tab=community&recipe=…`. The PWA is one static `index.html`, so
every messaging app previewed every link as a bare "ChefVoice", with no dish name and no photo.
Committed on `claude/audit-implementation-2026-09-28-e6a4a5`. **Not deployed yet**, and the order
matters (see the end).

## What changed

- **Links are now `https://chefvoice-d7fec.web.app/r/{recipeId}`**, from the PWA's Share button and
  from Android's share sheet (which only ever adds a link for a published recipe).
- **A new Cloud Functions codebase, `chefvoice-share`**, with one HTTP function, `recipeSharePage`.
  The PWA's Hosting target rewrites `/r/**` to it, ahead of the catch-all to `index.html`. It reads
  the one recipe and returns a small page of Open Graph tags: the recipe's name, its description (or
  "A recipe by … on ChefVoice"), its first photo, and the link. It is deployed on its own, like the
  other three codebases, and writes nothing.
- **That page is not the app.** A crawler reads the tags and never runs scripts. A person's browser
  runs `js/share-redirect.js`, the page's only script, and goes straight on to the old deep link,
  which the app already opens. Where the app's service worker is installed, the page is never
  fetched at all: the worker redirects `/r/{id}` itself, online or offline.
- **The service worker never stores a share page.** It saves any page it loads as the app shell
  for offline launches, so one visit to a share page would have replaced the offline app with it.
  Every `/r/` navigation is redirected before it can be stored.

## Privacy and safety

- **Only a public recipe is described.** A private, unpublished or missing recipe gets the same
  generic page, byte for byte, and the id is not echoed back. A link cannot tell anyone whether a
  recipe exists or what it is called.
- **Everything a chef wrote is escaped.** Only a photo from this project's own Storage bucket is
  handed to a crawler, the same rule `firestore.rules` holds new recipes to. An older recipe with a
  photo from anywhere else previews with the app icon.
- The page's own policy allows one script from the site and nothing else; the Hosting headers of
  the `pwa` target apply as well. A Firestore read that takes over 3 seconds gets the generic page,
  instead of an error when the function times out. At most five instances run, and the edge caches
  a described recipe for 5 minutes and the generic page for 1. The cache means **a recipe that is
  unpublished can still preview for up to 5 minutes**.
- `/r/` paths are read with one pattern, `[A-Za-z0-9_-]{1,128}`, in the function, the redirect
  script and the service worker; a test holds the three to the same answers on real and hostile
  paths.

## Tests

- Share **8 / 0** (new, `share/functions/share-page.test.js`): ids, a public recipe's tags, the
  redirect, the private-recipe page being identical to a missing one, escaping, the photo rule,
  long and missing words, headers.
- PWA **343 / 0** (+6, `tests/share-links.test.mjs`): the rewrite comes before the catch-all and
  names the right function and region; the codebase is its own; the PWA shares `/r/` links; the
  three `/r/` readers agree; the service worker redirects before anything can be stored.
- e2e **30 / 0** (+4, `e2e/share-links.spec.mjs`): a crawler gets tags and no app; a person lands
  on Community with the deep link; a malformed link lands on the app; with the app installed the
  page is never fetched, the stored app shell is still the app, and a share link opens offline.
  `e2e/serve.mjs` now mirrors the function rewrite, answering as the function does for a recipe it
  cannot read, and stops if `firebase.json` gains a rewrite to a function it does not know.
- Android **241 / 0** (2 skipped): `ShareUtilsTest` (2).
- Five breaks were each caught: the service worker letting `/r/` through, no redirect script, a
  page policy that blocks it, the rewrite missing, and the function describing private recipes.
- The function itself was run locally against a Firestore that cannot be reached: a `POST` is
  refused, a bad path and an unreadable recipe both get the generic page, the latter in 3 seconds.

## To release, in this order

1. **`DEPLOY_SHARE.cmd`** deploys only `chefvoice-share`, after `RUN_SHARE_GATES.cmd`. The function
   is public by design (`invoker: "public"`): the crawlers that draw previews carry no credentials.
2. **`DEPLOY_PWA.cmd`** afterwards. It now refuses to deploy while `firebase.json` rewrites to
   `recipeSharePage` and `firebase functions:list` does not show it, because a rewrite to a missing
   function breaks every shared link. Both paths of that check were run with a copy of the script
   that could not deploy.
3. Android 0.11.20 shares `/r/` links, so it should reach Play only after both.

Then: open `https://chefvoice-d7fec.web.app/r/<a public recipe's id>` and the recipe opens; view its
source with `curl` and the tags name the dish; a private recipe's id gives the generic tags; and
paste a link into WhatsApp or Messages to see the card. Worth checking once, too, whether Hosting
adds its own `**` headers to the function's page (the page sets its own either way).

Not done: Android does not open these links itself (that needs App Links: an `assetlinks.json` on
the site and an intent filter). They open in the browser, where the PWA takes them.
